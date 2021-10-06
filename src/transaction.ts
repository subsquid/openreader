import type {Pool, PoolClient, ClientBase} from "pg"


export class Transaction {
    private client: Promise<PoolClient> | undefined
    private closed = false

    constructor(private pool: Pool) {}

    get(): Promise<ClientBase> {
        if (this.closed) {
            throw new Error('Too late to request transaction')
        }
        if (this.client) {
            return this.client
        } else {
            return this.client = this.startTransaction()
        }
    }

    private async startTransaction(): Promise<PoolClient> {
        let client = await this.pool.connect()
        try {
            await client.query('START TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY')
            return client
        } catch(e: any) {
            client.release()
            throw e
        }
    }

    close(): Promise<void> {
        this.closed = true
        return this.client?.then(async client => {
            try {
                await client.query('COMMIT')
            } catch(e: any) {
                // ignore
            } finally {
                client.release()
            }
        }) || Promise.resolve()
    }
}
