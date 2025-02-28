export const METHODS_TO_REDIRECT: { [method: string]: boolean } = {
  eth_requestAccounts: true,
  eth_sendTransaction: true,
  eth_signTransaction: true,
  eth_sign: true,
  personal_sign: true,
  eth_signTypedData: true,
  eth_signTypedData_v3: true,
  eth_signTypedData_v4: true,
  wallet_watchAsset: true,
  wallet_addEthereumChain: true,
  wallet_switchEthereumChain: true,
};
export const STORAGE_PATH = '.sdk-comm';
export const STORAGE_PROVIDER_TYPE = 'providerType';
export const RPC_METHODS = {
  METAMASK_GETPROVIDERSTATE: 'metamask_getProviderState',
  ETH_REQUESTACCOUNTS: 'eth_requestAccounts',
};
