import {useDatabase, useServer} from "./util/setup"


describe('lists', function () {
    useDatabase([
        `create table lists (
            id text primary key, 
            int_array integer[], 
            bigint_array numeric[], 
            datetime_array timestamptz[],
            bytes_array bytea[],
            list_of_list_of_int jsonb, 
            list_of_json_objects jsonb
        )`,
        `insert into lists (id, int_array) values ('1', '{1, 2, 3}')`,
        `insert into lists (id, int_array) values ('2', '{4, 5, 6}')`,
        `insert into lists (id, bigint_array) values ('3', '{1000000000000000000000000000, 2000000000000000000000000000}')`,
        `insert into lists (id, bigint_array) values ('4', '{3000000000000000000000000000, 4000000000000000000000000000}')`,
        `insert into lists (id, list_of_list_of_int) values ('5', '[[1, 2], [3, 4], [5]]'::jsonb)`,
        `insert into lists (id, list_of_json_objects) values ('6', '[{"foo": 1, "bar": 2}, {"foo": 3, "bar": 4}]'::jsonb)`,
        `insert into lists (id, datetime_array) values ('7', array['2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z']::timestamptz[])`,
        `insert into lists (id, bytes_array) values ('8', array['hello', 'world']::bytea[])`,
    ])

    const client = useServer(`
        type Foo {
            foo: Int
            bar: Int
        }
    
        type Lists @entity {
            intArray: [Int!]
            bigintArray: [BigInt!]
            datetimeArray: [DateTime!]
            bytesArray: [Bytes!]
            listOfListOfInt: [[Int]]
            listOfJsonObjects: [Foo!]
        }
    `)

    describe('integer arrays', function () {
        it('outputs correctly', function () {
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
        it('outputs correctly', function () {
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

    describe('date-time arrays', function () {
        it('outputs correctly', function () {
            return client.test(`
                query {
                    lists(where: {id: "7"}) {
                        datetimeArray
                    }
                }
            `, {
                lists: [{
                    datetimeArray: [
                        '2020-01-01T00:00:00.000Z',
                        '2021-01-01T00:00:00.000Z'
                    ]
                }]
            })
        })
    })

    describe('bytes array', function () {
        it('outputs correctly', function () {
            return client.test(`
                query {
                    lists(where: {id: "8"}) {
                        bytesArray
                    }
                }
            `, {
                lists: [{
                    bytesArray: [
                        '0x68656c6c6f',
                        '0x776f726c64'
                    ]
                }]
            })
        })
    })

    describe('json lists', function () {
        it('outputs list of list of integers', function () {
            return client.test(`
                query {
                    lists(where: {id: "5"}) {
                        listOfListOfInt
                    }
                }
            `, {
                lists: [
                    {listOfListOfInt: [[1, 2], [3, 4], [5]]}
                ]
            })
        })

        it('outputs list of json objects', function () {
            return client.test(`
                query {
                    lists(where: {id: "6"}) {
                        listOfJsonObjects {
                            foo
                        }
                    }
                }
            `, {
                lists: [
                    {
                        listOfJsonObjects: [
                            {foo: 1},
                            {foo: 3}
                        ]
                    }
                ]
            })
        })
    })
})
