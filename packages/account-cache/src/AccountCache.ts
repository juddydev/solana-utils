import { AccountLoader } from "@nazaire/account-loader";
import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import DataLoader, { CacheMap } from "dataloader";
import { IDBPDatabase, openDB } from "idb";

class ExpiringAccountMap
  implements CacheMap<[PublicKey, number], Promise<AccountInfo<Buffer> | null>>
{
  private _map = new Map<
    string,
    [Promise<AccountInfo<Buffer> | null>, number]
  >();

  get(key: [PublicKey, number]) {
    const value = this._map.get(key[0].toString());
    if (value && value[1] > Date.now() - key[1]) return value[0];
    return undefined;
  }

  set(key: [PublicKey, number], value: Promise<AccountInfo<Buffer> | null>) {
    this._map.set(key[0].toString(), [value, Date.now()]);
  }

  delete(key: [PublicKey, number]) {
    this._map.delete(key[0].toString());
  }

  clear() {
    this._map.clear();
  }
}

export class AccountCache {
  private _loader: DataLoader<[PublicKey, number], AccountInfo<Buffer> | null>;

  constructor(
    public readonly connection: Connection,
    /**
     * An Account DataLoader with no in-memory cache
     */
    private _rpcLoader = new AccountLoader(connection, {
      cache: false,
    })
  ) {
    this._loader = new DataLoader(
      async (keys) => {
        const results: (AccountInfo<Buffer> | null | Error)[] = [];

        const stored = await Promise.all(
          keys.map(async ([publicKey, age], index) => {
            return {
              publicKey: publicKey,
              index,
              value: await this._get(publicKey, age),
            };
          })
        );

        const missing: { publicKey: PublicKey; index: number }[] = [];

        for (let i = 0; i < stored.length; i++) {
          const item = stored[i]!;

          if (item.value !== undefined) {
            results[item.index] = item.value.data;
          } else {
            missing.push(item);
          }
        }

        const loaded = await this._rpcLoader.loadMany(
          missing.map((item) => item.publicKey)
        );

        const putPromises: Promise<void>[] = [];

        for (let i = 0; i < loaded.length; i++) {
          const { publicKey, index } = missing[i]!;
          const result = loaded[i] as AccountInfo<Buffer> | Error | null;

          // store result at correct index

          results[index] = result;

          // save new results to cache
          if (!(result instanceof Error))
            putPromises.push(this._put(publicKey, result));
        }

        // wait for put promises to resolve
        await Promise.all(putPromises);

        return results;
      },
      {
        cacheMap: new ExpiringAccountMap(),
      }
    );
  }

  private _db:
    | IDBPDatabase<{
        accounts: {
          key: string;
          value: {
            publicKey: string;
            data: AccountInfo<Buffer> | null;
            ts: number;
          };
        };
      }>
    | undefined;

  public async getDb() {
    if (this._db) return this._db;
    else
      return (this._db = await openDB("solana-web-utils", 1, {
        upgrade(db) {
          db.createObjectStore("accounts", {
            keyPath: "publicKey",
          });
        },
      }));
  }

  private async _get(publicKey: PublicKey, maxAge: number) {
    const db = await this.getDb();

    const stored = await db.get("accounts", publicKey.toString());

    if (stored && stored.ts > Date.now() - maxAge) return stored;

    return undefined;
  }

  private async _put(publicKey: PublicKey, data: AccountInfo<Buffer> | null) {
    const db = await this.getDb();

    await db.put("accounts", {
      publicKey: publicKey.toString(),
      data,
      ts: Date.now(),
    });
  }

  load(publicKey: PublicKey, maxAge: number = Infinity) {
    return this._loader.load([publicKey, maxAge]);
  }

  // loadMany(queries: { publicKey: PublicKey; maxAge: number }[]) {
  //   return this._loader.loadMany(queries);
  // }

  async clear(publicKey: PublicKey) {
    await this.getDb().then((db) =>
      db.delete("accounts", publicKey.toString())
    );
    this._loader.clear([publicKey, 0]);
  }

  async clearAll() {
    await this.getDb().then((db) => db.clear("accounts"));
    this._loader.clearAll();
  }
}
