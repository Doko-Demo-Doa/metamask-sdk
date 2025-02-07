import {
  MetaMaskButton, useAccount, useSDK
} from '@metamask/sdk-react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletActions } from '../components/WalletActions';

export default function UIKitPage() {
  const { isConnected } = useAccount();
  const { connected } = useSDK();

  return (
    <>
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <header className="App-header">
        <h1 className="text-3xl font-bold underline">Testing UI Kits</h1>
        <Link href={'/'}>Index Page</Link>
        <div>
          <MetaMaskButton theme={'light'} color="white"></MetaMaskButton>
        </div>
        {connected && (
          <WalletActions />
        )}
      </header>
    </>
  );
}
