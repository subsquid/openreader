import {gql} from "apollo-server"
import {buildSchema} from "./gql/schema"
import {createServer} from "./server"


const schema = buildSchema(gql`
    type Account @entity {
        "Account address"
        id: ID!
        wallet: String!
        balance: BigInt!
        historicalBalances: [HistoricalBalance!] @derivedFrom(field: "account")
    }
    
    type HistoricalBalance @entity {
        id: ID!
        account: Account!
        balance: BigInt!
        timestamp: BigInt!
    }
`)


createServer({
    schema
}).listen(3000).then(
    () => {
        console.log('listening')
    },
    err => {
        console.error(err)
        process.exit(1)
    }
)
