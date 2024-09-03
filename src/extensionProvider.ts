import { IPlainTransactionObject, Message } from "@multiversx/sdk-core";
import { Transaction } from "@multiversx/sdk-core/out/transaction";
import {
  ErrAccountNotConnected,
  ErrCannotSignSingleTransaction,
} from "./errors";
import { Operation } from "./operation";
import {IDAppProviderAccount, IDAppProviderBase} from "@multiversx/sdk-dapp-utils/out";

declare global {
  interface Window {
    elrondWallet: { extensionId: string };
  }
}

export class ExtensionProvider implements IDAppProviderBase {
  public account: IDAppProviderAccount = { address: "" };
  private initialized: boolean = false;
  private static _instance: ExtensionProvider = new ExtensionProvider();

  private constructor() {
    if (ExtensionProvider._instance) {
      throw new Error(
        "Error: Instantiation failed: Use ExtensionProvider.getInstance() instead of new."
      );
    }
    ExtensionProvider._instance = this;
  }

  public static getInstance(): ExtensionProvider {
    return ExtensionProvider._instance;
  }

  public setAddress(address: string): ExtensionProvider {
    this.account.address = address;
    return ExtensionProvider._instance;
  }

  async init(): Promise<boolean> {
    if (window && window.elrondWallet) {
      this.initialized = true;
    }
    return this.initialized;
  }

  async login(
    options: {
      callbackUrl?: string;
      token?: string;
    } = {}
  ): Promise<IDAppProviderAccount> {
    if (!this.initialized) {
      throw new Error(
        "Extension provider is not initialised, call init() first"
      );
    }
    const { token } = options;
    const data = token ? token : "";
    await this.startBgrMsgChannel(Operation.Connect, data);
    return this.account;
  }

  async logout(): Promise<boolean> {
    if (!this.initialized) {
      throw new Error(
        "Extension provider is not initialised, call init() first"
      );
    }
    try {
      await this.startBgrMsgChannel(Operation.Logout, this.account.address);
      this.disconnect();
    } catch (error) {
      console.warn("Extension origin url is already cleared!", error);
    }

    return true;
  }

  private disconnect() {
    this.account = { address: "" };
  }

  async getAddress(): Promise<string> {
    if (!this.initialized) {
      throw new Error(
        "Extension provider is not initialised, call init() first"
      );
    }
    return this.account ? this.account.address : "";
  }

  isInitialized = (): boolean => {
    return this.initialized;
  };

  isConnected(): boolean {
    return Boolean(this.account.address);
  }

  getAccount(): IDAppProviderAccount | null {
    return this.account;
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    this.ensureConnected();

    const signedTransactions = await this.signTransactions([transaction]);

    if (signedTransactions.length != 1) {
      throw new ErrCannotSignSingleTransaction();
    }

    return signedTransactions[0];
  }

  private ensureConnected() {
    if (!this.account.address) {
      throw new ErrAccountNotConnected();
    }
  }

  async signTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    this.ensureConnected();

    const extensionResponse = await this.startBgrMsgChannel(
      Operation.SignTransactions,
      {
        from: this.account.address,
        transactions: transactions.map((transaction) =>
          transaction.toPlainObject()
        ),
      }
    );

    try {
      const transactionsResponse = extensionResponse.map(
        (transaction: IPlainTransactionObject) =>
          Transaction.fromPlainObject(transaction)
      );

      return transactionsResponse;
    } catch (error: any) {
      throw new Error(`Transaction canceled: ${error.message}.`);
    }
  }

  async signMessage(messageToSign: string): Promise<Message> {
    this.ensureConnected();

    const data = {
      account: this.account.address,
      message: messageToSign,
    };
    const extensionResponse = await this.startBgrMsgChannel(
      Operation.SignMessage,
      data
    );
    const signatureHex = extensionResponse.signature;
    const signature = Buffer.from(signatureHex, "hex");

    const message = new Message({
      data: Buffer.from(messageToSign)
    });
    message.signature = signature;

    return message;
  }

  cancelAction() {
    return this.startBgrMsgChannel(Operation.CancelAction, {});
  }

  private startBgrMsgChannel(
    operation: string,
    connectData: any
  ): Promise<any> {
    return new Promise((resolve) => {
      window.postMessage(
        {
          target: "erdw-inpage",
          type: operation,
          data: connectData,
        },
        window.origin
      );

      const eventHandler = (event: any) => {
        if (event.isTrusted && event.data.target === "erdw-contentScript") {
          if (event.data.type === "connectResponse") {
            if (event.data.data && Boolean(event.data.data.address)) {
              this.account = event.data.data;
            }
            window.removeEventListener("message", eventHandler);
            resolve(event.data.data);
          } else {
            window.removeEventListener("message", eventHandler);
            resolve(event.data.data);
          }
        }
      };
      window.addEventListener("message", eventHandler, false);
    });
  }
}
