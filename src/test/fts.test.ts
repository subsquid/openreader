import {useDatabase, useServer} from "./util/setup"

function tsvector(columns: string[]) {
    return columns.map(col => `setweight(to_tsvector('english', coalesce(${col}, '')), 'A')`).join(' || ')
}

function doc(columns: string[]) {
    return columns.map(col => `coalesce(${col}, '')`).join(` || E'\\n\\n' || `)
}

describe('full text search', function () {
    useDatabase([
        `create table foo (
            id text primary key, 
            foo int, 
            comment text, 
            search_tsv tsvector generated always as ( ${tsvector(['comment'])} ) stored,
            search_doc text generated always as ( ${doc(['comment'])} ) stored
        )`,
        `create table bar (
            id text primary key, 
            bar text, 
            description text, 
            search_tsv tsvector generated always as ( ${tsvector(['bar', 'description'])} ) stored,
            search_doc text generated always as ( ${doc(['bar', 'description'])} ) stored
        )`,
        `insert into foo (id, foo, comment) values ('1', 1, 'Some man greeted me with hello')`,
        `insert into foo (id, foo, comment) values ('2', 2, 'Deeply buried lorem ipsum dolor sit amet, then comes baz')`,
        `insert into foo (id, foo, comment) values ('3', 3, 'Lorem ipsum dolor sit amet')`,
        `insert into bar (id, bar, description) values ('1', 'every bar is followed by baz', 'Absolutely!')`,
        `insert into bar (id, bar, description) values ('2', 'qux', 'Baz should be here!')`,
    ])

    const client = useServer(`
        type Foo @entity {
            id: ID!
            foo: Int
            comment: String @fulltext(query: "search")
        }
        
        type Bar @entity {
            id: ID!
            bar: String @fulltext(query: "search")
            description: String @fulltext(query: "search")
        }
    `)

    it('finds "hello" across entities in Foo.comment', function () {
        return client.test(`
            query {
                search(text: "hello") {
                    item {
                        ... on Foo { id, foo }
                    }
                    highlight
                }
            }
        `, {
            search: [{
                item: {id: '1', foo: 1},
                highlight: 'Some man greeted me with <b>hello</b>'
            }]
        })
    })

    it('finds "absolute" across entities in Bar.description', function () {
        return client.test(`
            query {
                search(text: "absolute") {
                    item {
                        ... on Bar { id, bar }
                    }
                    highlight
                }
            }
        `, {
            search: [{
                item: {id: '1', bar: 'every bar is followed by baz'},
                highlight: 'every bar is followed by baz\n\n<b>Absolutely</b>!'
            }]
        })
    })
})
