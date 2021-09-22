import {useDatabase, useServer} from "./util/setup"


describe('lists', function () {
    useDatabase([
        `create table lists (id text primary key, int_array integer[], bigint_array numeric[])`,
        `insert into lists (id, int_array) values ('1', '{1, 2, 3}')`,
        `insert into lists (id, int_array) values ('2', '{4, 5, 6}')`,
        `insert into lists (id, bigint_array) values ('3', '{1000000000000000000000000000, 2000000000000000000000000000}')`,
        `insert into lists (id, bigint_array) values ('4', '{3000000000000000000000000000, 4000000000000000000000000000}')`,
    ])

    const client = useServer(`
        type Lists @entity {
            intArray: [Int!]
            bigintArray: [BigInt!]
        }
    `)

    describe('integer arrays', function () {
        it('transfers correctly', function () {
            return client.test(`
                query {
                    lists(where: {id_in: ["1", "2"]} orderBy: id_ASC) {
                        intArray
                    }
                }
            `, {
                lists: [
                    {intArray: [1, 2, 3]},
                    {intArray: [4, 5, 6]}
                ]
            })
        })
    })

    describe('big integer arrays', function () {
        it('transfers correctly', function () {
            return client.test(`
                query {
                    lists(where: {id_in: ["3", "4"]} orderBy: id_ASC) {
                        bigintArray
                    }
                }
            `, {
                lists: [
                    {bigintArray: ['1000000000000000000000000000', '2000000000000000000000000000']},
                    {bigintArray: ['3000000000000000000000000000', '4000000000000000000000000000']}
                ]
            })
        })
    })
})
