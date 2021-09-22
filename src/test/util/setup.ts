import {gql} from "apollo-server"
import {Client as PgClient, ClientBase, Pool} from "pg"
import {buildSchema} from "../../gql/schema"
import {readDbConfig} from "../../main"
import {createServer} from "../../server"
import {Client} from "./client"


export const db_config = readDbConfig()


async function withClient(block: (client: ClientBase) => Promise<void>): Promise<void> {
    let client = new PgClient(db_config)
    await client.connect()
    try {
        await block(client)
    } finally {
        await client.end()
    }
}


export function databaseInit(sql: string[]): Promise<void> {
    return withClient(async client => {
        for (let i = 0; i < sql.length; i++) {
            await client.query(sql[i])
        }
    })
}


export function databaseDelete(): Promise<void> {
    return withClient(async client => {
        await client.query(`DROP SCHEMA IF EXISTS public CASCADE`)
        await client.query(`CREATE SCHEMA public`)
    })
}


export function useDatabase(sql: string[]): void {
    before(async () => {
        await databaseDelete()
        await databaseInit(sql)
    })
}


export function useServer(schema: string): Client {
    let client = new Client('not defined')
    let db = new Pool(db_config)
    let server = createServer({
        schema: buildSchema(gql(schema)),
        db,
    })
    before(async () => {
        let info = await server.listen(0)
        client.endpoint = `http://localhost:${info.port}/graphql`
    })
    after(() => db.end())
    after(async () => {
        await server.stop()
    })
    return client
}
