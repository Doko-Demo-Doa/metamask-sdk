/* eslint-disable import/prefer-default-export */
import { EventEmitter2 } from 'eventemitter2';
import { v4 as uuidv4, validate } from 'uuid';
import packageJson from '../package.json';
import { SendAnalytics } from './Analytics';
import {
  CHANNEL_MAX_WAITING_TIME,
  DEFAULT_SERVER_URL,
  DEFAULT_SESSION_TIMEOUT_MS,
  RPC_METHODS,
} from './config';
import { ECIESProps } from './ECIES';
import { SocketService } from './SocketService';
// eslint-disable-next-line @typescript-eslint/no-shadow
import { AutoConnectOptions } from './types/AutoConnectOptions';
import { ChannelConfig } from './types/ChannelConfig';
import { CommunicationLayer } from './types/CommunicationLayer';
import { CommunicationLayerMessage } from './types/CommunicationLayerMessage';
import { CommunicationLayerPreference } from './types/CommunicationLayerPreference';
import { ConnectionStatus } from './types/ConnectionStatus';
import { DappMetadataWithSource } from './types/DappMetadata';
import { DisconnectOptions } from './types/DisconnectOptions';
import { EventType } from './types/EventType';
import { CommunicationLayerLoggingOptions } from './types/LoggingOptions';
import { MessageType } from './types/MessageType';
import { OriginatorInfo } from './types/OriginatorInfo';
import { PlatformType } from './types/PlatformType';
import { ServiceStatus } from './types/ServiceStatus';
import {
  StorageManager as SessionStorageManager,
  StorageManagerProps,
} from './types/StorageManager';
import { TrackingEvents } from './types/TrackingEvent';
import { WalletInfo } from './types/WalletInfo';
import { wait } from './utils/wait';

type MetaMaskMobile = 'metamask-mobile';

export interface RemoteCommunicationProps {
  platformType: PlatformType | MetaMaskMobile;
  communicationLayerPreference: CommunicationLayerPreference;
  otherPublicKey?: string;
  reconnect?: boolean;
  dappMetadata?: DappMetadataWithSource;
  walletInfo?: WalletInfo;
  transports?: string[];
  analytics?: boolean;
  communicationServerUrl?: string;
  ecies?: ECIESProps;
  sdkVersion?: string;
  storage?: StorageManagerProps;
  context: string;
  autoConnect?: AutoConnectOptions;
  logging?: CommunicationLayerLoggingOptions;
}

export class RemoteCommunication extends EventEmitter2 {
  // ready flag is turned on after we receive 'clients_ready' message, meaning key exchange is complete.
  private ready = false;

  // flag turned on once the connection has been authorized on the wallet.
  private authorized = false;

  private isOriginator = false;

  private paused = false;

  private otherPublicKey?: string;

  private transports?: string[];

  private platformType: PlatformType | MetaMaskMobile;

  private analytics = false;

  private channelId?: string;

  private channelConfig?: ChannelConfig;

  private walletInfo?: WalletInfo;

  private communicationLayer?: CommunicationLayer;

  private originatorInfo?: OriginatorInfo;

  private originatorInfoSent = false;

  private dappMetadata?: DappMetadataWithSource;

  private communicationServerUrl: string;

  private context: string;

  private storageManager?: SessionStorageManager;

  private storageOptions?: StorageManagerProps;

  private sdkVersion?: string;

  private autoConnectOptions;

  // Keep track if the other side is connected to the socket
  private clientsConnected = false;

  private sessionDuration: number = DEFAULT_SESSION_TIMEOUT_MS;

  // this flag is switched on when the connection is automatically initialized after finding existing channel configuration.
  private originatorConnectStarted = false;

  private debug = false;

  private logging?: CommunicationLayerLoggingOptions;

  // Status of the other side of the connection
  // 1) if I am MetaMask then other is Dapp
  // 2) If I am Dapp (isOriginator==true) then other side is MetaMask
  // Should not be set directly, use this.setConnectionStatus() instead to always emit events.
  private _connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  constructor({
    platformType,
    communicationLayerPreference,
    otherPublicKey,
    reconnect,
    walletInfo,
    dappMetadata,
    transports,
    context,
    ecies,
    analytics = false,
    storage,
    sdkVersion,
    communicationServerUrl = DEFAULT_SERVER_URL,
    logging,
    autoConnect = {
      timeout: CHANNEL_MAX_WAITING_TIME,
    },
  }: RemoteCommunicationProps) {
    super();

    this.otherPublicKey = otherPublicKey;
    this.dappMetadata = dappMetadata;
    this.walletInfo = walletInfo;
    this.transports = transports;
    this.platformType = platformType;
    this.analytics = analytics;
    this.communicationServerUrl = communicationServerUrl;
    this.context = context;
    this.sdkVersion = sdkVersion;

    this.setMaxListeners(50);

    this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
    if (storage?.duration) {
      this.sessionDuration = DEFAULT_SESSION_TIMEOUT_MS;
    }
    this.storageOptions = storage;
    this.autoConnectOptions = autoConnect;
    this.debug = logging?.remoteLayer === true;
    this.logging = logging;

    if (storage?.storageManager) {
      this.storageManager = storage.storageManager;
    }

    this.initCommunicationLayer({
      communicationLayerPreference,
      otherPublicKey,
      reconnect,
      ecies,
      communicationServerUrl,
    });

    this.emitServiceStatusEvent();
  }

  private initCommunicationLayer({
    communicationLayerPreference,
    otherPublicKey,
    reconnect,
    ecies,
    communicationServerUrl = DEFAULT_SERVER_URL,
  }: Pick<
    RemoteCommunicationProps,
    | 'communicationLayerPreference'
    | 'otherPublicKey'
    | 'reconnect'
    | 'ecies'
    | 'communicationServerUrl'
  >) {
    // this.communicationLayer?.removeAllListeners();

    switch (communicationLayerPreference) {
      case CommunicationLayerPreference.SOCKET:
        this.communicationLayer = new SocketService({
          communicationLayerPreference,
          otherPublicKey,
          reconnect,
          transports: this.transports,
          communicationServerUrl,
          context: this.context,
          ecies,
          logging: this.logging,
        });
        break;
      default:
        throw new Error('Invalid communication protocol');
    }

    let url = (typeof document !== 'undefined' && document.URL) || '';
    let title = (typeof document !== 'undefined' && document.title) || '';

    if (this.dappMetadata?.url) {
      url = this.dappMetadata.url;
    }

    if (this.dappMetadata?.name) {
      title = this.dappMetadata.name;
    }

    const originatorInfo: OriginatorInfo = {
      url,
      title,
      source: this.dappMetadata?.source,
      icon: this.dappMetadata?.base64Icon,
      platform: this.platformType,
      apiVersion: packageJson.version,
    };
    this.originatorInfo = originatorInfo;

    // TODO below listeners is only added for backward compatibility with wallet < 7.3
    this.communicationLayer?.on(EventType.AUTHORIZED, async () => {
      if (this.authorized) {
        // Ignore duplicate event or already authorized
        return;
      }

      // Sometime the wallet version is not yet received upon authorized message
      const waitForWalletVersion = async () => {
        while (!this.walletInfo) {
          await wait(500);
        }
      };
      await waitForWalletVersion();

      // The event might be received twice because of a backward compatibility hack in SocketService.
      // bacward compatibility for wallet <7.3
      const compareValue = '7.3'.localeCompare(this.walletInfo?.version || '');

      if (this.debug) {
        console.debug(
          `RemoteCommunication HACK 'authorized' version=${this.walletInfo?.version} compareValue=${compareValue}`,
        );
      }

      // FIXME remove this hack pending wallet release 7.3+
      if (compareValue !== 1) {
        // ignore for version 7.3+
        return;
      }

      const isSecurePlatform =
        this.platformType === PlatformType.MobileWeb ||
        this.platformType === PlatformType.ReactNative ||
        this.platformType === PlatformType.MetaMaskMobileWebview;

      if (this.debug) {
        console.debug(
          `RemoteCommunication HACK 'authorized' platform=${this.platformType} secure=${isSecurePlatform} channel=${this.channelId} walletVersion=${this.walletInfo?.version}`,
        );
      }

      if (isSecurePlatform) {
        // Propagate authorized event.
        this.authorized = true;
        this.emit(EventType.AUTHORIZED);
      }
    });

    this.communicationLayer?.on(
      EventType.MESSAGE,
      (_message: CommunicationLayerMessage) => {
        let message = _message;
        // check if message is encapsulated for backward compatibility
        if (_message.message) {
          message = message.message as CommunicationLayerMessage;
        }
        this.onCommunicationLayerMessage(message);
      },
    );

    this.communicationLayer?.on(EventType.CLIENTS_CONNECTED, () => {
      // Propagate the event to manage different loading states on the ui.
      if (this.debug) {
        console.debug(
          `RemoteCommunication::on 'clients_connected' channel=${
            this.channelId
          } keysExchanged=${this.getKeyInfo()?.keysExchanged}`,
        );
      }

      if (this.analytics) {
        SendAnalytics(
          {
            id: this.channelId ?? '',
            event: TrackingEvents.REQUEST,
            ...originatorInfo,
            commLayer: communicationLayerPreference,
            sdkVersion: this.sdkVersion,
            walletVersion: this.walletInfo?.version,
            commLayerVersion: packageJson.version,
          },
          this.communicationServerUrl,
        ).catch((err) => {
          console.error(`Cannot send analytics`, err);
        });
      }

      this.clientsConnected = true;
      this.originatorInfoSent = false; // Always re-send originator info.
      this.emit(EventType.CLIENTS_CONNECTED);
    });

    this.communicationLayer?.on(EventType.KEYS_EXCHANGED, (message) => {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::${this.context}::on commLayer.'keys_exchanged' channel=${this.channelId}`,
          message,
        );
      }

      if (this.getKeyInfo()?.keysExchanged) {
        this.setConnectionStatus(ConnectionStatus.LINKED);
      }

      this.setLastActiveDate(new Date());

      if (this.analytics && this.channelId) {
        SendAnalytics(
          {
            id: this.channelId,
            event: TrackingEvents.CONNECTED,
            sdkVersion: this.sdkVersion,
            commLayer: communicationLayerPreference,
            commLayerVersion: packageJson.version,
            walletVersion: this.walletInfo?.version,
          },
          this.communicationServerUrl,
        ).catch((err) => {
          console.error(`Cannot send analytics`, err);
        });
      }

      this.isOriginator = message.isOriginator;

      if (!message.isOriginator) {
        // Don't send originator message from wallet.
        // Always Tell the DAPP metamask is ready
        // the dapp will send originator message when receiving ready.
        this.communicationLayer?.sendMessage({ type: MessageType.READY });
        this.ready = true;
        this.paused = false;
      }

      // Keep sending originator info from this location for backward compatibility
      if (message.isOriginator && !this.originatorInfoSent) {
        // Always re-send originator info in case the session was deleted on the wallet
        this.communicationLayer?.sendMessage({
          type: MessageType.ORIGINATOR_INFO,
          originatorInfo: this.originatorInfo,
          originator: this.originatorInfo,
        });
        this.originatorInfoSent = true;
      }
    });

    this.communicationLayer?.on(EventType.SOCKET_DISCONNECTED, () => {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::on 'socket_Disconnected' set ready to false`,
        );
      }
      this.ready = false;
    });

    this.communicationLayer?.on(EventType.SOCKET_RECONNECT, () => {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::on 'socket_reconnect' -- reset key exchange status / set ready to false`,
        );
      }
      this.ready = false;
      this.clean();
    });

    this.communicationLayer?.on(
      EventType.CLIENTS_DISCONNECTED,
      (channelId: string) => {
        if (this.debug) {
          console.debug(
            `RemoteCommunication::${this.context}]::on 'clients_disconnected' channelId=${channelId}`,
          );
        }

        this.clientsConnected = false;

        // Propagate the disconnect event to clients.
        this.emit(EventType.CLIENTS_DISCONNECTED, this.channelId);
        this.setConnectionStatus(ConnectionStatus.DISCONNECTED);

        this.ready = false;
        this.authorized = false;

        if (this.analytics && this.channelId) {
          SendAnalytics(
            {
              id: this.channelId,
              event: TrackingEvents.DISCONNECTED,
              sdkVersion: this.sdkVersion,
              commLayer: communicationLayerPreference,
              commLayerVersion: packageJson.version,
              walletVersion: this.walletInfo?.version,
            },
            this.communicationServerUrl,
          ).catch((err) => {
            console.error(`Cannot send analytics`, err);
          });
        }
      },
    );

    this.communicationLayer?.on(EventType.CHANNEL_CREATED, (id) => {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::${this.context}::on 'channel_created' channelId=${id}`,
        );
      }
      this.emit(EventType.CHANNEL_CREATED, id);
    });

    this.communicationLayer?.on(EventType.CLIENTS_WAITING, (numberUsers) => {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::${this.context}::on 'clients_waiting' numberUsers=${numberUsers} ready=${this.ready} autoStarted=${this.originatorConnectStarted}`,
        );
      }

      this.setConnectionStatus(ConnectionStatus.WAITING);

      this.emit(EventType.CLIENTS_WAITING, numberUsers);
      if (this.originatorConnectStarted) {
        if (this.debug) {
          console.debug(
            `RemoteCommunication::on 'clients_waiting' watch autoStarted=${this.originatorConnectStarted} timeout`,
            this.autoConnectOptions,
          );
        }

        const timeout = this.autoConnectOptions.timeout || 3000;
        const timeoutId = setTimeout(() => {
          if (this.debug) {
            console.debug(
              `RemoteCommunication::on setTimeout(${timeout}) terminate channelConfig`,
              this.autoConnectOptions,
            );
          }
          // Cleanup previous channelId
          // this.storageManager?.terminate();
          this.originatorConnectStarted = false;
          if (!this.ready) {
            this.setConnectionStatus(ConnectionStatus.TIMEOUT);
          }
          clearTimeout(timeoutId);
        }, timeout);
      }
    });
  }

  private onCommunicationLayerMessage(message: CommunicationLayerMessage) {
    if (this.debug) {
      console.debug(
        `RemoteCommunication::${
          this.context
        }::on 'message' typeof=${typeof message}`,
        message,
      );
    }

    this.ready = true;

    if (!this.isOriginator && message.type === MessageType.ORIGINATOR_INFO) {
      // TODO why these hardcoded value?
      this.communicationLayer?.sendMessage({
        type: MessageType.WALLET_INFO,
        walletInfo: this.walletInfo,
      });
      this.originatorInfo = message.originatorInfo || message.originator;
      this.emit(EventType.CLIENTS_READY, {
        isOriginator: this.isOriginator,
        originatorInfo: this.originatorInfo,
      });
      this.paused = false;
      return;
    } else if (this.isOriginator && message.type === MessageType.WALLET_INFO) {
      this.walletInfo = message.walletInfo;
      this.paused = false;

      // FIXME Remove comment --- but keep temporarily for reference in case of quick rollback
      // if ('6.6'.localeCompare(this.walletInfo?.version || '') === 1) {
      //   // SIMULATE AUTHORIZED EVENT
      //   // FIXME remove hack as soon as ios release 7.x is out
      //   this.authorized = true;
      //   this.emit(EventType.AUTHORIZED);

      //   if (this.debug) {
      //     // Check for backward compatibility
      //     console.debug(
      //       `wallet version ${this.walletInfo?.version} -- Force simulate AUTHORIZED event`,
      //       this.walletInfo,
      //     );
      //   }
      // }

      return;
    } else if (message.type === MessageType.TERMINATE) {
      // remove channel config from persistence layer and close active connections.
      if (this.isOriginator) {
        this.disconnect({ terminate: true, sendMessage: false });
        console.debug();
        this.emit(EventType.TERMINATE);
      }
    } else if (message.type === MessageType.PAUSE) {
      this.paused = true;
      this.setConnectionStatus(ConnectionStatus.PAUSED);
    } else if (message.type === MessageType.READY && this.isOriginator) {
      this.setConnectionStatus(ConnectionStatus.LINKED);

      // keep track of resumed state before resetting it and emitting messages
      // Better to reset the paused status before emitting as otherwise it may interfer.
      const resumed = this.paused;
      // Reset paused status
      this.paused = false;

      this.emit(EventType.CLIENTS_READY, {
        isOriginator: this.isOriginator,
        walletInfo: this.walletInfo,
      });

      if (resumed) {
        this.authorized = true;
        // If connection is resumed, automatically assume authorized.
        this.emit(EventType.AUTHORIZED);
      }
    } else if (message.type === MessageType.OTP && this.isOriginator) {
      // OTP message are ignored on the wallet.
      this.emit(EventType.OTP, message.otpAnswer);

      // backward compatibility for wallet <6.6
      if ('6.6'.localeCompare(this.walletInfo?.version || '') === 1) {
        console.warn(
          `RemoteCommunication::on 'otp' -- backward compatibility <6.6 -- triger eth_requestAccounts`,
        );

        this.emit(EventType.SDK_RPC_CALL, {
          method: RPC_METHODS.ETH_REQUESTACCOUNTS,
          params: [],
        });
      }
      return;
    } else if (message.type === MessageType.AUTHORIZED && this.isOriginator) {
      this.authorized = true;
      this.emit(EventType.AUTHORIZED);
    }

    // TODO should it check if only emiting JSON-RPC message?
    this.emit(EventType.MESSAGE, message);
  }

  /**
   * Connect from the dapp using session persistence.
   */
  async originatorSessionConnect(): Promise<ChannelConfig | undefined> {
    if (!this.storageManager) {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::connect() no storage manager defined - skip`,
        );
      }
      return undefined;
    }

    const channelConfig = await this.storageManager.getPersistedChannelConfig(
      this.channelId ?? '',
    );
    if (this.debug) {
      console.debug(
        `RemoteCommunication::connect() autoStarted=${this.originatorConnectStarted} channelConfig`,
        channelConfig,
      );
    }

    const connected = this.communicationLayer?.isConnected();
    if (connected) {
      if (this.debug) {
        console.debug(
          `RemoteCommunication::connect() socket already connected - skip`,
        );
      }
      return channelConfig;
    }

    if (channelConfig) {
      const validSession = channelConfig.validUntil > Date.now();

      if (validSession) {
        this.channelConfig = channelConfig;
        this.originatorConnectStarted = true;
        this.channelId = channelConfig?.channelId;
        this.communicationLayer?.connectToChannel({
          channelId: channelConfig.channelId,
          isOriginator: true,
        });
        return channelConfig;
      } else if (this.debug) {
        console.log(`RemoteCommunication::autoConnect Session has expired`);
      }
    }
    this.originatorConnectStarted = false;
    return undefined;
  }

  async generateChannelIdConnect() {
    if (!this.communicationLayer) {
      throw new Error('communication layer not initialized');
    }

    if (this.ready) {
      throw new Error('Channel already connected');
    }

    if (this.channelId && this.isConnected()) {
      console.warn(
        `Channel already exists -- interrupt generateChannelId`,
        this.channelConfig,
      );

      this.channelConfig = {
        channelId: this.channelId,
        validUntil: Date.now() + this.sessionDuration,
      };
      this.storageManager?.persistChannelConfig(this.channelConfig);

      return {
        channelId: this.channelId,
        pubKey: this.getKeyInfo()?.ecies.public,
      };
    }

    if (this.debug) {
      console.debug(`RemoteCommunication::generateChannelId()`);
    }

    this.clean();
    const channel = this.communicationLayer.createChannel();

    if (this.debug) {
      console.debug(
        `RemoteCommunication::generateChannelId() channel created`,
        channel,
      );
    }

    const channelConfig = {
      channelId: channel.channelId,
      validUntil: Date.now() + this.sessionDuration,
    };
    this.channelId = channel.channelId;
    this.channelConfig = channelConfig;
    // save current channel config
    this.storageManager?.persistChannelConfig(channelConfig);

    return { channelId: this.channelId, pubKey: channel.pubKey };
  }

  clean() {
    if (this.debug) {
      console.debug(`RemoteCommunication::${this.context}::clean()`);
    }

    this.channelConfig = undefined;
    this.ready = false;
    this.originatorConnectStarted = false;
  }

  connectToChannel(channelId: string, withKeyExchange?: boolean) {
    if (!validate(channelId)) {
      console.debug(
        `RemoteCommunication::${this.context}::connectToChannel() invalid channel channelId=${channelId}`,
      );
      throw new Error(`Invalid channel ${channelId}`);
    }

    if (this.debug) {
      console.debug(
        `RemoteCommunication::${this.context}::connectToChannel() channelId=${channelId}`,
      );
    }

    if (this.communicationLayer?.isConnected()) {
      // Adding a check on previous connection to prevent reconnecting during dev when HMR is enabled
      console.debug(
        `RemoteCommunication::${this.context}::connectToChannel() already connected - interrup connection.`,
      );
      return;
    }

    this.channelId = channelId;
    this.communicationLayer?.connectToChannel({ channelId, withKeyExchange });
    const newChannelConfig: ChannelConfig = {
      channelId,
      validUntil: Date.now() + this.sessionDuration,
    };
    this.channelConfig = newChannelConfig;
    this.storageManager?.persistChannelConfig(newChannelConfig);
  }

  private async handleAuthorization(
    message: CommunicationLayerMessage,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (this.debug) {
        console.log(
          `RemoteCommunication::${this.context}::sendMessage::handleAuthorization ready=${this.ready} authorized=${this.authorized} method=${message.method}`,
        );
      }

      // TODO remove after wallet 7.3+ is deployed
      // backward compatibility for wallet <7.3
      if ('7.3'.localeCompare(this.walletInfo?.version || '') === 1) {
        if (this.debug) {
          console.debug(
            `compatibility hack wallet version > ${this.walletInfo?.version}`,
          );
        }
        this.communicationLayer?.sendMessage(message);
        resolve();
        return;
      }

      if (!this.isOriginator || this.authorized) {
        this.communicationLayer?.sendMessage(message);
        resolve();
      } else {
        this.once(EventType.AUTHORIZED, () => {
          if (this.debug) {
            console.log(
              `RemoteCommunication::${this.context}::sendMessage  AFTER SKIP / AUTHORIZED -- sending pending message`,
            );
          }
          // only send the message after the clients have awaken.
          this.communicationLayer?.sendMessage(message);
          resolve();
        });
      }
    });
  }

  sendMessage(message: CommunicationLayerMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.debug) {
        console.log(
          `RemoteCommunication::${this.context}::sendMessage paused=${
            this.paused
          } ready=${this.ready} authorized=${
            this.authorized
          } socker=${this.communicationLayer?.isConnected()} clientsConnected=${
            this.clientsConnected
          } status=${this._connectionStatus}`,
          message,
        );
      }

      if (
        this.paused ||
        !this.ready ||
        !this.communicationLayer?.isConnected() ||
        !this.clientsConnected
      ) {
        if (this.debug) {
          console.log(
            `RemoteCommunication::${this.context}::sendMessage  SKIP message waiting for MM mobile readiness.`,
          );
        }

        this.once(EventType.CLIENTS_READY, async () => {
          if (this.debug) {
            console.log(
              `RemoteCommunication::${this.context}::sendMessage  AFTER SKIP / READY -- sending pending message`,
            );
          }

          try {
            await this.handleAuthorization(message);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      } else {
        // Send the message or wait for authorization
        this.handleAuthorization(message)
          .then(() => {
            resolve();
          })
          .catch((err) => {
            console.error(
              `RemoteCommunication::${this.context}::sendMessage  ERROR`,
              err,
            );
            reject(err);
          });
      }
    });
  }

  async testStorage() {
    const res = await this.storageManager?.getPersistedChannelConfig(
      this.channelId ?? '',
    );
    console.debug(`RemoteCommunication.testStorage() res`, res);
  }

  private setLastActiveDate(lastActiveDate: Date) {
    if (this.debug) {
      console.debug(
        `RemoteCommunication::setLastActiveDate() channel=${this.channelId}`,
        lastActiveDate,
      );
    }
    const newChannelConfig: ChannelConfig = {
      channelId: this.channelId ?? '',
      validUntil: this.channelConfig?.validUntil ?? 0,
      lastActive: lastActiveDate.getTime(),
    };
    this.storageManager?.persistChannelConfig(newChannelConfig);
  }

  getChannelConfig() {
    return this.channelConfig;
  }

  /**
   * Check if the connection is ready to handle secure communication.
   *
   * @returns boolean
   */
  isReady() {
    return this.ready;
  }

  /**
   * Check the value of the socket io client.
   *
   * @returns boolean
   */
  isConnected() {
    return this.communicationLayer?.isConnected();
  }

  isAuthorized() {
    return this.authorized;
  }

  isPaused() {
    return this.paused;
  }

  getCommunicationLayer() {
    return this.communicationLayer;
  }

  ping() {
    if (this.debug) {
      console.debug(`RemoteCommunication::ping() channel=${this.channelId}`);
    }

    this.communicationLayer?.ping();
  }

  keyCheck() {
    if (this.debug) {
      console.debug(
        `RemoteCommunication::keyCheck() channel=${this.channelId}`,
      );
    }

    this.communicationLayer?.keyCheck();
  }

  private setConnectionStatus(connectionStatus: ConnectionStatus) {
    if (this._connectionStatus === connectionStatus) {
      return; // Don't re-emit current status.
    }
    this._connectionStatus = connectionStatus;
    this.emit(EventType.CONNECTION_STATUS, connectionStatus);
    this.emitServiceStatusEvent();
  }

  private emitServiceStatusEvent() {
    this.emit(EventType.SERVICE_STATUS, this.getServiceStatus());
  }

  getConnectionStatus() {
    return this._connectionStatus;
  }

  getServiceStatus(): ServiceStatus {
    return {
      originatorInfo: this.originatorInfo,
      keyInfo: this.getKeyInfo(),
      connectionStatus: this._connectionStatus,
      channelConfig: this.channelConfig,
      channelId: this.channelId,
    };
  }

  getKeyInfo() {
    return this.communicationLayer?.getKeyInfo();
  }

  resetKeys() {
    this.communicationLayer?.resetKeys();
  }

  pause() {
    if (this.debug) {
      console.debug(`RemoteCommunication::pause() channel=${this.channelId}`);
    }
    this.communicationLayer?.pause();
    this.setConnectionStatus(ConnectionStatus.PAUSED);
  }

  getVersion() {
    return packageJson.version;
  }

  resume() {
    if (this.debug) {
      console.debug(`RemoteCommunication::resume() channel=${this.channelId}`);
    }
    this.communicationLayer?.resume();
    this.setConnectionStatus(ConnectionStatus.LINKED);
  }

  getChannelId() {
    return this.channelId;
  }

  disconnect(options?: DisconnectOptions) {
    if (this.debug) {
      console.debug(
        `RemoteCommunication::disconnect() channel=${this.channelId}`,
        options,
      );
    }

    this.ready = false;
    this.paused = false;

    if (options?.terminate) {
      // remove channel config from persistence layer and close active connections.
      this.storageManager?.terminate(this.channelId ?? '');

      if (
        this.communicationLayer?.getKeyInfo().keysExchanged &&
        options?.sendMessage
      ) {
        this.communicationLayer?.sendMessage({ type: MessageType.TERMINATE });
      }

      this.channelId = uuidv4();
      options.channelId = this.channelId;
      this.channelConfig = undefined;
      this.originatorConnectStarted = false;
      this.communicationLayer?.disconnect(options);
      this.setConnectionStatus(ConnectionStatus.TERMINATED);
    } else {
      this.communicationLayer?.disconnect(options);
      this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
    }
  }
}
