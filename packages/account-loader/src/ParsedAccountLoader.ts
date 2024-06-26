import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import DataLoader from "dataloader";
import { AccountLoader } from "./AccountLoader";
import { AccountParsersMap } from "./types";

export class ParsedAccountLoader<AccountParsers extends {}> {
  private _parsers: AccountParsersMap<AccountParsers>;
  private _loader: AccountLoader;

  constructor(
    connection: Connection,
    parsers: AccountParsersMap<AccountParsers>,
    options?: DataLoader.Options<PublicKey, AccountInfo<Buffer> | null, string>
  ) {
    this._loader = new AccountLoader(connection, options);
    this._parsers = { ...parsers };
  }

  /**
   * Loads a key, returning a `Promise` for the value represented by that key.
   */
  async load<K extends keyof AccountParsers>(
    publicKey: PublicKey,
    type: K
  ): Promise<AccountParsers[K] | null>;
  async load(
    publicKey: PublicKey,
    type: undefined
  ): Promise<AccountInfo<Buffer> | null>;
  async load<K extends keyof AccountParsers>(
    publicKey: PublicKey,
    type: K | undefined
  ): Promise<AccountParsers[K] | AccountInfo<Buffer> | null>;
  async load(publicKey: PublicKey, type?: keyof AccountParsers) {
    const account = await this._loader.load(publicKey);
    if (!account) return null;
    if (type) return this._parsers[type](account, publicKey);
    else return account;
  }


  async loadMany<
    Keys extends readonly (readonly [
      PublicKey,
      keyof AccountParsers | undefined
    ])[]
  >(keys: Keys) {
    var loadPromises = [];

    for (var i = 0; i < keys.length; i++) {
      loadPromises.push(
        this.load(keys[i]![0], keys[i]![1])["catch"](function (error) {
          return error;
        })
      );
    }

    return Promise.all(loadPromises) as {
      [K in keyof Keys]: Keys[K][1] extends keyof AccountParsers
        ? AccountParsers[Keys[K][1]] | Error | null
        : AccountInfo<Buffer> | Error | null;
    };
  }

  /**
   * Clears the value at `key` from the cache, if it exists. Returns itself for
   * method chaining.
   */
  clear(key: PublicKey): this {
    this._loader.clear(key);
    return this;
  }

  /**
   * Clears the entire cache. To be used when some event results in unknown
   * invalidations across this particular `DataLoader`. Returns itself for
   * method chaining.
   */
  clearAll(): this {
    this._loader.clearAll();
    return this;
  }

  /**
   * Adds the provided key and value to the cache. If the key already exists, no
   * change is made. Returns itself for method chaining.
   */
  prime(key: PublicKey, value: AccountInfo<Buffer> | Error): this {
    this._loader.prime(key, value);
    return this;
  }
}
