import { useEffect, useRef, useState } from 'react';
import './App.css';
import { MetaMaskSDK, SDKProvider } from '@metamask/sdk';
import { ConnectionStatus, EventType, ServiceStatus } from '@metamask/sdk-communication-layer';
import React from 'react';

export const App = () => {
  const [chain, setChain] = useState("");
  const [account, setAccount] = useState<string>();
  const [response, setResponse] = useState<unknown>("");
  const [connected, setConnected] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>();
  const [sdk, setSDK] = useState<MetaMaskSDK>();
  const [activeProvider, setActiveProvider] = useState<SDKProvider>();
  const hasInit = useRef(false);

  useEffect(() => {
    if(!activeProvider) return;

    const onChainChanged = (chain) => {
      console.log(chain);
      setChain(chain);
    }

    const onAccountsChanged = (accounts) => {
      console.log(accounts);
      setAccount(accounts?.[0]);
    }

    window.ethereum?.on("chainChanged", onChainChanged);
    window.ethereum?.on("accountsChanged", onAccountsChanged);

    return () => {
      window.ethereum?.removeListener("chainChanged", onChainChanged);
      window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
    }
  }, [activeProvider]);


  useEffect( () => {
    if(hasInit.current) {
      return;
    }

    hasInit.current = true;

    const onProviderEvent = (accounts) => {
      console.debug(`onProviderEvent`, accounts);
      if (accounts?.[0]?.startsWith('0x')) {
        setAccount(accounts?.[0]);
        setConnected(true);
      } else {
        setAccount(undefined);
        setConnected(false);
      }
    }

    const doAsync = async () => {
      const clientSDK = new MetaMaskSDK({
        autoConnect: {
          enable: false
        },
        logging:{
          developerMode: true,
        },
        dappMetadata: {
          name: "Demo React App",
          url: window.location.host,
        }
      });
      await clientSDK.init();

      // listen for provider change events
      clientSDK.on(EventType.PROVIDER_UPDATE, onProviderEvent);

      setSDK(clientSDK);
      setActiveProvider(clientSDK.getProvider());
    };

    doAsync();

    return () => {
      if(sdk) {
        sdk.removeListener(EventType.SERVICE_STATUS, onProviderEvent);
      }
    }
  });

  const connect = () => {
    if(!window.ethereum) {
      throw new Error(`invalid ethereum provider`);
    }
    window.ethereum
      .request({
        method: "eth_requestAccounts",
        params: [],
      })
      .then((accounts) => {
        if(accounts) {
          console.debug(`connect:: accounts result`);
          setAccount((accounts as string[])[0]);
          setConnected(true);
        }
      })
      .catch((e) => console.log("request accounts ERR", e));
  };

  const addEthereumChain = () => {
    if(!window.ethereum) {
      throw new Error(`invalid ethereum provider`);
    }

    window.ethereum
      .request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x89",
            chainName: "Polygon",
            blockExplorerUrls: ["https://polygonscan.com"],
            nativeCurrency: { symbol: "MATIC", decimals: 18 },
            rpcUrls: ["https://polygon-rpc.com/"],
          },
        ],
      })
      .then((res) => console.log("add", res))
      .catch((e) => console.log("ADD ERR", e));
  };

  const sendTransaction = async () => {
    const to = "0x0000000000000000000000000000000000000000";
    const transactionParameters = {
      to, // Required except during contract publications.
      from: window.ethereum?.selectedAddress, // must match user's active address.
      value: "0x5AF3107A4000", // Only required to send ether to the recipient from the initiating external account.
    };

    try {
      // txHash is a hex string
      // As with any RPC call, it may throw an error
      const txHash = await window.ethereum?.request({
        method: "eth_sendTransaction",
        params: [transactionParameters],
      }) as string;

      setResponse(txHash);
    } catch (e) {
      console.log(e);
    }
  };

  const sign = async () => {
    const msgParams = JSON.stringify({
      domain: {
        // Defining the chain aka Rinkeby testnet or Ethereum Main Net
        chainId: parseInt(window.ethereum?.chainId ?? "", 16),
        // Give a user friendly name to the specific contract you are signing for.
        name: "Ether Mail",
        // If name isn't enough add verifying contract to make sure you are establishing contracts with the proper entity
        verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
        // Just let's you know the latest version. Definitely make sure the field name is correct.
        version: "1",
      },

      // Defining the message signing data content.
      message: {
        /*
         - Anything you want. Just a JSON Blob that encodes the data you want to send
         - No required fields
         - This is DApp Specific
         - Be as explicit as possible when building out the message schema.
        */
        contents: "Hello, Bob!",
        attachedMoneyInEth: 4.2,
        from: {
          name: "Cow",
          wallets: [
            "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
            "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
          ],
        },
        to: [
          {
            name: "Bob",
            wallets: [
              "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
              "0xB0BdaBea57B0BDABeA57b0bdABEA57b0BDabEa57",
              "0xB0B0b0b0b0b0B000000000000000000000000000",
            ],
          },
        ],
      },
      // Refers to the keys of the *types* object below.
      primaryType: "Mail",
      types: {
        // TODO: Clarify if EIP712Domain refers to the domain the contract is hosted on
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        // Not an EIP712Domain definition
        Group: [
          { name: "name", type: "string" },
          { name: "members", type: "Person[]" },
        ],
        // Refer to PrimaryType
        Mail: [
          { name: "from", type: "Person" },
          { name: "to", type: "Person[]" },
          { name: "contents", type: "string" },
        ],
        // Not an EIP712Domain definition
        Person: [
          { name: "name", type: "string" },
          { name: "wallets", type: "address[]" },
        ],
      },
    });

    let from = window.ethereum?.selectedAddress;

    console.debug(`sign from: ${from}`);
    try {
      if (!from || from===null) {
        alert(`Invalid account -- please connect using eth_requestAccounts first`);
        return;
      }

      const params = [from, msgParams];
      const method = "eth_signTypedData_v4";
      console.debug(`ethRequest ${method}`, JSON.stringify(params, null, 4))
      console.debug(`sign params`, params);
      const resp = await window.ethereum?.request({ method, params });
      setResponse(resp);
    } catch (e) {
      console.log(e);
    }
  };

  const terminate = () => {
    sdk?.terminate();
  }

  const changeNetwork = async (hexChainId:string) => {
    console.debug(`switching to network chainId=${hexChainId}`)
    try {
      const response = await window.ethereum?.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }] // chainId must be in hexadecimal numbers
      })
      console.debug(`response`, response)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="App">
      <div className="sdkConfig">
          {serviceStatus?.connectionStatus===ConnectionStatus.WAITING &&
            <div>
              Waiting for Metamask to link the connection...
            </div>
          }
      </div>

      {connected ? <div>
          <button style={{ padding: 10, margin: 10 }} onClick={connect}>
            Request Accounts
          </button>

          <button style={{ padding: 10, margin: 10 }} onClick={sign}>
            Sign
          </button>

          <button style={{ padding: 10, margin: 10 }} onClick={sendTransaction} >
            Send transaction
          </button>

          <button style={{ padding: 10, margin: 10 }} onClick={() => changeNetwork('0x1')} >
            Switch Ethereum
          </button>

          <button style={{ padding: 10, margin: 10 }} onClick={() => changeNetwork('0x89')} >
            Switch Polygon
          </button>

          <button style={{ padding: 10, margin: 10 }} onClick={addEthereumChain} >
            Add ethereum chain
          </button>
        </div> :
        <button style={{ padding: 10, margin: 10 }} onClick={connect}>
          Connect
        </button>
      }

      <button style={{ padding: 10, margin: 10, backgroundColor: 'red' }} onClick={terminate} >
        Terminate
      </button>

      <div>
        <>
          {chain && `Connected chain: ${chain}`}
          <p></p>
          {account && `Connected account: ${account}`}
          <p></p>
          {response && `Last request response: ${response}`}
        </>
      </div>
    </div>
  );
}

export default App;
