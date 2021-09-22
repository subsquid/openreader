import {useDatabase, useServer} from "./util/setup"

describe('scalars', function() {
    useDatabase([
        `create table scalar (id text primary key, "boolean" bool, "bigint" numeric, "string" text, "bytes" bytea)`,
        `insert into scalar (id, "boolean") values ('1', true)`,
        `insert into scalar (id, "boolean") values ('2', false)`,
        `insert into scalar (id, "bigint") values ('3', 1000000000000000000000000000000000000)`,
        `insert into scalar (id, "bigint") values ('4', 2000000000000000000000000000000000000)`,
        `insert into scalar (id, "bigint") values ('5', 5)`,
        `insert into scalar (id, "string") values ('6', 'foo bar baz')`,
        `insert into scalar (id, "string") values ('7', 'bar baz foo')`,
        `insert into scalar (id, "string") values ('8', 'baz foo bar')`,
        `insert into scalar (id, "string") values ('9', 'hello')`,
    ])

    const client = useServer(`
        type Scalar @entity {
            id: ID!
            boolean: Boolean
            bigint: BigInt
            string: String
        }
    `)

    describe('Boolean', function () {
        it('transfers correctly', function () {
            return client.test(`
                query {
                    scalars(where: {id_in: ["1", "2"]} orderBy: id_ASC) {
                        id
                        boolean
                    }
                }
            `, {
                scalars: [
                    {id: '1', boolean: true},
                    {id: '2', boolean: false}
                ]
            })
        })

        it('supports where conditions', function () {
            return client.test(`
                query {
                    t: scalars(where: {boolean: true}) { id }
                    f: scalars(where: {boolean: false}) { id }
                    nt: scalars(where: {boolean_not: true}) { id }
                    nf: scalars(where: {boolean_not: false}) { id }
                }
            `, {
                t: [{id: '1'}],
                f: [{id: '2'}],
                nt: [{id: '2'}],
                nf: [{id: '1'}]
            })
        })
    })

    describe('BigInt', function () {
        it('transfers correctly', function () {
            return client.test(`
                query {
                    scalars(where: {id_in: ["3", "4", "5"]} orderBy: id_ASC) {
                        id
                        bigint
                    }
                }
            `, {
                scalars: [
                    {id: '3', bigint: '1000000000000000000000000000000000000'},
                    {id: '4', bigint: '2000000000000000000000000000000000000'},
                    {id: '5', bigint: '5'}
                ]
            })
        })

        it('supports where conditions', function () {
            return client.test(`
                query {
                    eq: scalars(where: {bigint: 2000000000000000000000000000000000000} orderBy: id_ASC) { id }
                    not_eq: scalars(where: {bigint_not: 2000000000000000000000000000000000000} orderBy: id_ASC) { id }
                    gt: scalars(where: {bigint_gt: 1000000000000000000000000000000000000} orderBy: id_ASC) { id }
                    gte: scalars(where: {bigint_gte: 1000000000000000000000000000000000000} orderBy: id_ASC) { id }
                    lt: scalars(where: {bigint_lt: 1000000000000000000000000000000000000} orderBy: id_ASC) { id }
                    lte: scalars(where: {bigint_lte: 1000000000000000000000000000000000000} orderBy: id_ASC) { id }
                    in: scalars(where: {bigint_in: [1000000000000000000000000000000000000, 5]} orderBy: id_ASC) { id }
                    not_in: scalars(where: {bigint_not_in: [1000000000000000000000000000000000000, 5]} orderBy: id_ASC) { id }
                }
            `, {
                eq: [{id: '4'}],
                not_eq: [{id: '3'}, {id: '5'}],
                gt: [{id: '4'}],
                gte: [{id: '3'}, {id: '4'}],
                lt: [{id: '5'}],
                lte: [{id: '3'}, {id: '5'}],
                in: [{id: '3'}, {id: '5'}],
                not_in: [{id: '4'}]
            })
        })

        it('supports sorting', function () {
            return client.test(`
                query {
                    asc: scalars(where: {id_in: ["3", "4", "5"]} orderBy: bigint_ASC) {
                        id
                    }
                    desc: scalars(where: {id_in: ["3", "4", "5"]} orderBy: bigint_DESC) {
                        id
                    }
                }
            `, {
                asc: [
                    {id: '5'},
                    {id: '3'},
                    {id: '4'}
                ],
                desc: [
                    {id: '4'},
                    {id: '3'},
                    {id: '5'},
                ]
            })
        })
    })

    describe('String', function () {
        it('supports where conditions', function () {
            return client.test(`
                query {
                    starts_with: scalars(where: {string_starts_with: "foo"} orderBy: id_ASC) { id }
                    not_starts_with: scalars(where: {string_not_starts_with: "foo"} orderBy: id_ASC) { id }
                    ends_with: scalars(where: {string_ends_with: "foo"} orderBy: id_ASC) { id }
                    not_ends_with: scalars(where: {string_not_ends_with: "foo"} orderBy: id_ASC) { id }
                    contains: scalars(where: {string_contains: "foo"} orderBy: id_ASC) { id }
                    not_contains: scalars(where: {string_not_contains: "foo"} orderBy: id_ASC) { id }
                    case_sensitive: scalars(where: {string_contains: "Foo"} orderBy: id_ASC) { id }
                }
            `, {
                starts_with: [{id: '6'}],
                not_starts_with: [{id: '7'}, {id: '8'}, {id: '9'}],
                ends_with: [{id: '7'}],
                not_ends_with: [{id: '6'}, {id: '8'}, {id: '9'}],
                contains: [{id: '6'}, {id: '7'}, {id: '8'}],
                not_contains: [{id: '9'}],
                case_sensitive: []
            })
        })
    })
})
