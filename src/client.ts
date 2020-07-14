import * as connext from "@connext/client";
import {
  IConnextClient,
  ChannelProviderConfig,
  PublicParams,
  ConditionalTransferTypes,
  IStoreService,
} from "@connext/types";
import { Wallet, constants } from "ethers";

import config from "./config";

import {
  storeMnemonic,
  storeInitOptions,
  getClientBalance,
  getFreeBalanceOnChain,
  EventSubscriptionParams,
  InitClientManagerOptions,
  InitOptions,
  EventSubscription,
  transferOnChain,
} from "./helpers";
import Subscriber from "./subscriber";

const { AddressZero } = constants;

export default class ClientManager {
  private _client: IConnextClient | undefined;
  private _logger: any;
  private _mnemonic: string | undefined;
  private _subscriber: Subscriber;
  private _store: IStoreService;
  private _initializing = false;

  constructor(opts: InitClientManagerOptions) {
    this._logger = opts.logger;
    this._mnemonic = opts.mnemonic;
    this._subscriber = new Subscriber(opts.logger, opts.store);
    this._store = opts.store;
  }

  get mnemonic(): string {
    return this._mnemonic || config.mnemonic;
  }

  set mnemonic(value: string) {
    this._mnemonic = value;
  }

  public async initClient(
    opts?: Partial<InitOptions>,
    subscriptions?: EventSubscription[],
  ): Promise<IConnextClient> {
    const mnemonic = opts?.mnemonic || this.mnemonic;
    if (!mnemonic) {
      throw new Error("Cannot init Connext client without mnemonic");
    }

    if (this._initializing) {
      throw new Error(`Client is initializing`);
    }

    if (this._client) {
      this._logger.info("Client is already connected - skipping initClient logic");
      return this._client;
    }

    this._initializing = true;
    this.setMnemonic(mnemonic);
    const network = opts?.network || config.network;
    const ethProviderUrl = opts?.ethProviderUrl || config.ethProviderUrl;
    const nodeUrl = opts?.nodeUrl || config.nodeUrl;
    const logLevel = opts?.logLevel || config.logLevel;
    const signer = Wallet.fromMnemonic(mnemonic).privateKey;
    const clientOpts = { signer, store: this._store, ethProviderUrl, nodeUrl, logLevel };
    try {
      const client = await connext.connect(network, clientOpts);
      this._client = client;
      this._logger.info("Client initialized successfully");
      return client;
    } finally {
      this._initializing = false;
    }
  }

  public async getConfig(): Promise<Partial<ChannelProviderConfig>> {
    const client = this.getClient();
    const config = {
      multisigAddress: undefined,
      ...client.channelProvider.config,
    };
    if (!config.multisigAddress) {
      throw new Error("Connext Client Not Yet Initialized");
    }
    return config;
  }

  public async getTransferHistory() {
    const client = this.getClient();
    const transferHistory = await client.getTransferHistory();
    return transferHistory;
  }

  public async getAppInstanceDetails(appIdentityHash: string) {
    const client = this.getClient();
    const appDetails = await client.getAppInstance(appIdentityHash);
    const data = appDetails;
    return data;
  }

  public async hashLockTransfer(params: PublicParams.HashLockTransfer) {
    const client = this.getClient();
    if (params.assetId === AddressZero) {
      delete params.assetId;
    }
    const response = await client.conditionalTransfer({
      conditionType: ConditionalTransferTypes.HashLockTransfer,
      amount: params.amount,
      recipient: params.recipient,
      lockHash: params.lockHash,
      assetId: params.assetId,
      meta: params.meta,
      timelock: params.timelock,
    } as PublicParams.ConditionalTransfer);
    const appDetails = await client.getAppInstance(response.appIdentityHash);
    const data = { ...response, ...appDetails };
    return data;
  }

  public async hashLockResolve(params: PublicParams.ResolveHashLockTransfer) {
    const client = this.getClient();
    const response = await client.resolveCondition({
      conditionType: ConditionalTransferTypes.HashLockTransfer,
      preImage: params.preImage,
      assetId: params.assetId,
    } as PublicParams.ResolveHashLockTransfer);
    const data = response;
    return data;
  }

  public async linkedStatus(paymentId: string) {
    const client = this.getClient();
    const response = await client.getLinkedTransfer(paymentId);
    if (!response) {
      throw new Error(`No Linked Transfer found for paymentId: ${paymentId}`);
    }
    const data = response;
    return data;
  }

  public async linkedTransfer(params: PublicParams.LinkedTransfer) {
    const client = this.getClient();
    if (params.assetId === AddressZero) {
      delete params.assetId;
    }
    const response = await client.conditionalTransfer({
      conditionType: ConditionalTransferTypes.LinkedTransfer,
      amount: params.amount,
      recipient: params.recipient,
      preImage: params.preImage,
      assetId: params.assetId,
      meta: params.meta,
    } as PublicParams.ConditionalTransfer);
    const appDetails = await client.getAppInstance(response.appIdentityHash);
    const data = { ...response, ...appDetails };
    return data;
  }

  public async linkedResolve(params: PublicParams.ResolveLinkedTransfer) {
    const client = this.getClient();
    const response = await client.resolveCondition({
      conditionType: ConditionalTransferTypes.LinkedTransfer,
      preImage: params.preImage,
      paymentId: params.paymentId,
    } as PublicParams.ResolveLinkedTransfer);
    const data = response;
    return data;
  }

  public async hashLockStatus(lockHash: string, assetId: string) {
    const client = this.getClient();
    const response = await client.getHashLockTransfer(lockHash, assetId);
    if (!response) {
      throw new Error(
        `No HashLock Transfer found for lockHash: ${lockHash} and assetId: ${assetId}`,
      );
    }
    const data = response;
    return data;
  }

  public async balance(assetId: string) {
    const client = this.getClient();
    return getClientBalance(client, assetId);
  }

  public async setMnemonic(mnemonic: string) {
    await storeMnemonic(mnemonic, this._store);
    console.log("resolved to store mnemonic");
    this._mnemonic = mnemonic;
    this._logger.info("Mnemonic set successfully");
  }

  public async deposit(params: PublicParams.Deposit) {
    const client = this.getClient();
    const assetId = params.assetId || AddressZero;
    if (params.assetId === AddressZero) {
      delete params.assetId;
    }
    const response = await client.deposit(params);
    return {
      freeBalanceOffChain: response.freeBalance[client.signerAddress].toString(),
      freeBalanceOnChain: await getFreeBalanceOnChain(client, assetId),
    };
  }

  public async swap(params: PublicParams.Swap) {
    const client = this.getClient();
    await client.swap(params);
    return {
      fromAssetIdBalance: await getFreeBalanceOnChain(client, params.fromAssetId),
      toAssetIdBalance: await getFreeBalanceOnChain(client, params.toAssetId),
    };
  }

  public async transferOnChain(params: {
    amount: string;
    assetId: string;
    recipient: string;
  }): Promise<{ txhash: string }> {
    const client = this.getClient();
    const txhash = await transferOnChain({
      mnemonic: this.mnemonic,
      ethProvider: client.ethProvider,
      assetId: params.assetId,
      amount: params.amount,
      recipient: params.recipient,
    });
    return { txhash };
  }

  public async withdraw(params: PublicParams.Withdraw) {
    const client = this.getClient();
    if (params.assetId === AddressZero) {
      delete params.assetId;
    }
    const response = await client.withdraw(params);
    return response;
  }

  public async subscribe(params: EventSubscriptionParams): Promise<{ id: string }> {
    const client = this.getClient();
    const subscription = await this._subscriber.subscribe(client, params);
    return { id: subscription.id };
  }

  public async subscribeBatch(
    paramsArr: EventSubscriptionParams[],
  ): Promise<{ subscriptions: EventSubscription[] }> {
    const client = this.getClient();
    const subscriptions = await this._subscriber.batchSubscribe(client, paramsArr);
    return { subscriptions };
  }

  public async unsubscribe(id: string) {
    const client = this.getClient();
    await this._subscriber.unsubscribe(client, id);
    return { success: true };
  }

  public async unsubscribeBatch(idsArr: string[]) {
    const client = this.getClient();
    await this._subscriber.batchUnsubscribe(client, idsArr);
    return { success: true };
  }

  public async unsubscribeAll() {
    const client = this.getClient();
    await this._subscriber.clearAllSubscriptions(client);
    return { success: true };
  }

  // -- Private ---------------------------------------------------------------- //

  private getClient(): IConnextClient {
    if (!this._client) {
      throw new Error("Client is not initialized");
    }
    return this._client;
  }

  private async updateClient(
    client: IConnextClient,
    initOpts: Partial<InitOptions>,
    subscriptions?: EventSubscription[],
  ) {
    if (this._client) {
      await this._subscriber.clearAllSubscriptions(this._client);
    }
    this._client = client;
    await this.initSubscriptions(subscriptions);
    await storeInitOptions(initOpts, this._store);
  }

  private async initSubscriptions(subscriptions?: EventSubscription[]) {
    if (subscriptions && subscriptions.length) {
      const client = this.getClient();
      await this._subscriber.batchResubscribe(client, subscriptions);
    }
  }
}
