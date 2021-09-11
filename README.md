# OpenReader

WIP: GraphQL server which given [hydra schema](https://docs.subsquid.io/schema-spec) and database connection
serves "read part" of [OpenCRUD spec](https://www.opencrud.org).

## What should work

Custom scalars:

* `ID`
* `BigInt`

Directives:

* `@entity`
* `@derivedFrom`

Example query

```graphql
query {
  accounts(limit: 10, offset: 0, where: {wallet: "5HKcLj5vuexs9K6jAGdjErKijVFciLQzWBoJtj7cmrqe6GpB"}) {
    id
    wallet
    historicalBalances(where: {balance_gte: 126130735358896, AND: {balance_lt: "126130735358897"}}) {
      balance
    }
  }
}
```

## Usage

```bash
openreader schema.graphql
```

Database connection and server port can be configured using hydra environment variables:

```
DB_NAME
DB_USER
DB_PASS
DB_HOST
DB_PORT
GRAPHQL_SERVER_PORT
```
