import type {IFieldResolver, IResolvers} from "@graphql-tools/utils"
import assert from "assert"
import type {GraphQLResolveInfo, KindEnum} from "graphql"
import graphqlFields from "graphql-fields"
import type {ClientBase} from "pg"
import type {Entity, Model} from "./model"
import {fromStringCast, getScalarResolvers, toStringCast} from "./scalars"
import {toColumn, toFkColumn, toQueryListField, toTable} from "./util"
import {hasConditions, parseWhereField} from "./where"


export interface ResolverContext {
    db: ClientBase
    model: Model
}


export function buildResolvers(model: Model): IResolvers {
    let Query: Record<string, IFieldResolver<unknown, ResolverContext>> = {}
    for (let name in model) {
        Query[toQueryListField(name)] = (source, args, context, info) => {
            return resolveEntityList(name, args, context, info)
        }
    }
    return {Query, ...getScalarResolvers()}
}


export interface ListArgs {
    offset?: number
    limit?: number
    orderBy?: string[]
    where?: any
}


async function resolveEntityList(entityName: string, args: ListArgs, context: ResolverContext, info: GraphQLResolveInfo): Promise<any[]> {
    let fields = requestedFields(info)
    let query = new QueryBuilder(context)
    let sql = query.select(entityName, fields, args)
    console.log('\n' + sql)
    let result = await context.db.query({text: sql, rowMode: 'array'}, query.params)
    return query.toResult(result.rows, entityName, fields)
}


function requestedFields(info: GraphQLResolveInfo): RequestedFields {
    return graphqlFields(info, {}, {
        processArguments: true,
        excludedFields: ['__typename']
    })
}


export type RequestedFields = {
    [field: string]: RequestedFields
} & {
    __arguments?: FieldArgument[]
}


/*
 * Argument of a nested field extracted by graphql-fields
 */
interface FieldArgument {
    [name: string]: {
        kind: KindEnum
        value: any
    }
}


function toListArgs(fieldArguments?: FieldArgument[]): ListArgs {
    if (!fieldArguments) return {}
    let list: ListArgs = {}
    fieldArguments.forEach(arg => {
        for (let name in arg) {
            let value = arg[name].value
            switch(name) {
                case 'orderBy':
                    let orderBy = value
                    if (!Array.isArray(orderBy)) {
                        // https://github.com/robrichard/graphql-fields/issues/32
                        orderBy = [orderBy]
                    }
                    list.orderBy = orderBy
                    break
                case 'where':
                case 'limit':
                case 'offset':
                    list[name] = value
                    break
            }
        }
    })
    return list
}


class QueryBuilder {
    public params: any[] = []
    private aliases: AliasSet = new AliasSet()
    private db: ClientBase
    private model: Model

    constructor(ctx: ResolverContext) {
        this.db = ctx.db
        this.model = ctx.model
    }

    private param(value: any): string {
        return '$' + this.params.push(value)
    }

    private ident(name: string): string {
        return this.db.escapeIdentifier(name)
    }

    select(entityName: string, fields: RequestedFields, args: ListArgs, subquery?: ListSubquery): string {
        let entity = this.model[entityName]
        let table = toTable(entityName)
        let alias = this.aliases.add(table)
        let join = new FkJoinSet(this.aliases)
        let whereExp = ''

        let columns: string[] = []
        this.populateColumns(columns, fields, alias, entity, join)
        let columnExp = columns.join(', ')
        if (subquery) {
            columnExp = `jsonb_build_array(${columnExp})`
        }

        let out = `SELECT ${columnExp}\nFROM ${this.ident(table)} ${this.ident(alias)}`

        if (hasConditions(args.where)) {
            whereExp = this.generateWhere(alias, entity, args.where, join)
        }

        if (join.isNotEmpty()) {
            out += join.render(name => this.ident(name))
        }

        if (subquery) {
            let subWhere = `${this.ident(alias)}.${this.ident(toFkColumn(subquery.field))} = ${this.ident(subquery.parent)}."id"`
            whereExp = whereExp ? `${subWhere} AND (${whereExp})` : subWhere
        }

        if (whereExp) {
            out += '\nWHERE ' + whereExp
        }

        if (args.limit) {
            out += '\nLIMIT ' + this.param(args.limit)
        }

        if (args.offset) {
            out += '\nOFFSET ' + this.param(args.offset)
        }

        if (subquery) {
            out = '(' + out.replace(/\n/g, ' ') + ')'
        }

        return out
    }

    private populateColumns(columns: string[], fields: RequestedFields, alias: string, entity: Entity, join: FkJoinSet): void {
        for (let key in fields) {
            if (key == '__arguments') {
                continue
            }
            if (entity.columns[key]) {
                columns.push(
                    toStringCast(
                        entity.columns[key].graphqlType,
                        this.ident(alias) + '.' + this.ident(toColumn(key))
                    )
                )
            } else {
                let rel = entity.relations[key]
                switch(rel.type) {
                    case 'FK':
                        this.populateColumns(
                            columns,
                            fields[key],
                            join.add(
                                toTable(rel.foreignEntity),
                                alias,
                                toFkColumn(key)
                            ),
                            this.model[rel.foreignEntity],
                            join
                        )
                        break
                    case 'LIST':
                        columns.push(
                            'array' + this.select(
                                rel.entity,
                                fields[key],
                                toListArgs(fields[key].__arguments),
                                {field: rel.field, parent: alias}
                            )
                        )
                        break
                }
            }
        }
    }

    private generateWhere(alias: string, entity: Entity, where: any, join: FkJoinSet): string {
        let {AND, OR, ...conditions} = where
        let exps: string[] = []
        for (let key in conditions) {
            if (entity.relations[key]) {
                let f_where = conditions[key]
                if (hasConditions(f_where)) {
                    let rel = entity.relations[key]
                    assert(rel.type == 'FK')
                    exps.push(
                        this.generateWhere(
                            join.add(toTable(rel.foreignEntity), alias, toFkColumn(key)),
                            this.model[rel.foreignEntity],
                            f_where,
                            join
                        )
                    )
                }
            } else {
                let value = conditions[key]
                let f = parseWhereField(key)
                let param = this.param(value)
                let scalarType = entity.columns[f.field].graphqlType
                exps.push(`${this.ident(alias)}.${this.ident(f.field)} ${f.op} ${fromStringCast(scalarType, param)}`)
            }
        }
        if (AND) {
            // We are getting objects here, although we have array in schema
            if (!Array.isArray(AND)) {
                AND = [AND]
            }
            AND.forEach((andWhere: any) => {
                if (hasConditions(andWhere)) {
                    exps.push(
                        this.generateWhere(alias, entity, andWhere, join)
                    )
                }
            })
        }
        if (OR) {
            // We are getting objects here, although we have array in schema
            if (!Array.isArray(OR)) {
                OR = [OR]
            }
            let ors = [`(${exps.join(' AND ')})`]
            OR.forEach((orWhere: any) => {
                if (hasConditions(orWhere)) {
                    ors.push(
                        `(${this.generateWhere(alias, entity, orWhere, join)})`
                    )
                }
            })
            return ors.join(' OR ')
        } else {
            return exps.join(' AND ')
        }
    }

    toResult(rows: any[][], entityName: string, fields: RequestedFields): any[] {
        let entity = this.model[entityName]
        let out: any[] = new Array(rows.length)
        for (let i = 0; i < rows.length; i++) {
            out[i] = this.mapRow(rows[i], 0, entity, fields).rec
        }
        return out
    }

    private mapRow(row: any[], idx: number, entity: Entity, fields: RequestedFields): {rec: any, idx: any} {
        let rec: any = {}
        for (let key in fields) {
            if (key == '__arguments') {
                continue
            }
            if (entity.columns[key]) {
                rec[key] = row[idx]
                idx += 1
            } else {
                let rel = entity.relations[key]
                switch(rel.type) {
                    case 'FK':
                        let m = this.mapRow(row, idx, this.model[rel.foreignEntity], fields[key])
                        rec[key] = m.rec
                        idx = m.idx
                        break
                    case 'LIST':
                        rec[key] = this.toResult(row[idx], rel.entity, fields[key])
                        idx += 1
                        break
                }
            }
        }
        return {rec, idx}
    }
}


/**
 * (SELECT ... FROM table WHERE table.{toFkColumn(field)} = {parent}.id)
 */
interface ListSubquery {
    field: string
    parent: string
}


/**
 * LEFT OUTER JOIN {table} {alias} on {alias}.id = {on_alias}.{on_field}
 */
interface FK_Join {
    table: string
    alias: string
    on_alias: string
    on_field: string
}


class FkJoinSet {
    private joins: Map<string, FK_Join> = new Map()

    constructor(private aliases: AliasSet) {}

    add(table: string, on_alias: string, on_field: string): string {
        let key = table + '  ' + on_alias + '  ' + on_field
        let e = this.joins.get(key)
        if (!e) {
            e = {
                table,
                alias: this.aliases.add(table),
                on_alias,
                on_field
            }
            this.joins.set(key, e)
        }
        return e.alias
    }

    isNotEmpty() {
        return this.joins.size > 0
    }

    render(escapeIdentifier: (name: string) => string): string {
        let e = escapeIdentifier
        let out = ''
        this.joins.forEach(join => {
            out += `\nLEFT OUTER JOIN ${e(join.table)} ${e(join.alias)} ON ${e(join.alias)}."id" = ${e(join.on_alias)}.${e(join.on_field)}`
        })
        return out
    }
}


class AliasSet {
    private aliases: Record<string, number> = {}

    add(name: string): string {
        if (this.aliases[name]) {
            return name + '_' + (this.aliases[name]++)
        } else {
            this.aliases[name] = 1
            return name
        }
    }
}
