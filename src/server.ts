import {ApolloServer} from "apollo-server"
import {GraphQLRequestContext} from "apollo-server-types"
import {GraphQLSchema} from "graphql"
import {Pool, PoolClient, PoolConfig} from "pg"
import {buildServerSchema} from "./gql/opencrud"
import {getModel} from "./gql/schema"
import {buildResolvers, ResolverContext} from "./resolver"


export interface ServerOptions {
    schema: GraphQLSchema
    db?: PoolConfig
}


export function createServer(options: ServerOptions): ApolloServer {
    let model = getModel(options.schema)
    let pool = new Pool(options.db)
    return new ApolloServer({
        typeDefs: buildServerSchema(options.schema),
        resolvers: buildResolvers(model),
        context: async () => {
            let db = await pool.connect()
            try {
                await db.query('START TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            } catch(e) {
                db.release()
                throw e
            }
            return {db, model}
        },
        plugins: [cleanupDbPlugin],
        introspection: true
    })
}


const cleanupDbPlugin = {
    async requestDidStart() {
        return {
            async willSendResponse(req: GraphQLRequestContext) {
                let ctx = req.context as ResolverContext
                try {
                    await ctx.db.query('ROLLBACK')
                } finally {
                    (ctx.db as PoolClient).release()
                }
            }
        }
    }
}
