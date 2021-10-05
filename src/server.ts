import type {IResolvers} from "@graphql-tools/utils"
import {ApolloServerPluginDrainHttpServer} from "apollo-server-core"
import type {PluginDefinition} from "apollo-server-core/src/types"
import {ApolloServer} from "apollo-server-express"
import assert from "assert"
import express from "express"
import fs from "fs"
import type {DocumentNode} from "graphql"
import http from "http"
import path from "path"
import type {Pool} from "pg"
import {buildServerSchema} from "./gql/opencrud"
import type {Model} from "./model"
import {buildResolvers, ResolverContext} from "./resolver"


export type ResolversMap = IResolvers


export interface ListeningServer {
    readonly port: number
    stop(): Promise<void>
}


export interface ServerOptions {
    model: Model
    db: Pool
}


export class Server {
    private db: Pool
    private model: Model

    constructor(options: ServerOptions) {
        this.db = options.db
        this.model = options.model
    }

    buildTypeDefs(): DocumentNode[] {
        return [buildServerSchema(this.model)]
    }

    buildResolvers(): ResolversMap {
        return buildResolvers(this.model)
    }

    buildContext(): () => Promise<ResolverContext> {
        return async () => {
            return {openReaderDatabase: this.db}
        }
    }

    buildPlugins(): PluginDefinition[] {
        return []
    }

    applyConsole(app: express.Application): void {
        let assets = path.join(
            require.resolve('@subsquid/graphiql-console/package.json'),
            '../build'
        )

        let indexHtml = fs.readFileSync(path.join(assets, 'index.html'), 'utf-8')
            .replace(/\/static\//g, 'console/static/')
            .replace('/manifest.json', 'console/manifest.json')
            .replace('${GRAPHQL_API}', 'graphql')
            .replace('${APP_TITLE}', 'Query node playground')

        app.use('/console', express.static(assets))

        app.use('/graphql', (req, res, next) => {
            if (req.path != '/') return next()
            if (req.method != 'GET' && req.method != 'HEAD') return next()
            if (req.query['query']) return next()
            res.vary('Accept')
            if (!req.accepts('html')) return next()
            res.type('html').send(indexHtml)
        })
    }

    async listen(port?: number | string): Promise<ListeningServer> {
        let app = express()
        let server = http.createServer(app)
        let apollo = new ApolloServer({
            typeDefs: this.buildTypeDefs(),
            resolvers: this.buildResolvers(),
            context: this.buildContext(),
            plugins: [
                ...this.buildPlugins(),
                ApolloServerPluginDrainHttpServer({httpServer: server})
            ]
        })

        await apollo.start()
        this.applyConsole(app)
        apollo.applyMiddleware({app})

        return new Promise((resolve, reject) => {
            function onerror(err: Error) {
                cleanup()
                reject(err)
            }

            function onlistening() {
                cleanup()
                let address = server.address()
                assert(address != null && typeof address == 'object')
                resolve({
                    port: address.port,
                    stop: () => apollo.stop()
                })
            }

            function cleanup() {
                server.removeListener('error', onerror)
                server.removeListener('listening', onlistening)
            }

            server.on('error', onerror)
            server.on('listening', onlistening)
            server.listen(port)
        })
    }
}
