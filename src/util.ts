import {pluralize, underscore} from "inflected"


export {pluralize}


function snakeCase(name: string): string {
    return underscore(name)
}


export function weakMemo<T extends object, R>(f: (val: T) => R): (val: T) => R {
    let cache = new WeakMap<T, R>()
    return function(val: T): R {
        let r = cache.get(val)
        if (r === undefined) {
            r = f(val)
            cache.set(val, r)
        }
        return r
    }
}


export function lowerCaseFirst(s: string): string {
    if (s) {
        return s[0].toLowerCase() + s.slice(1)
    } else {
        return s
    }
}


export function toQueryListField(entityName: string): string {
    return pluralize(lowerCaseFirst(entityName))
}


export function toColumn(gqlFieldName: string): string {
    return snakeCase(gqlFieldName)
}


export function toFkColumn(gqlFieldName: string): string {
    return snakeCase(gqlFieldName) + '_id'
}


export function toTable(entityName: string): string {
    return snakeCase(entityName)
}


export class Output {
    private out = ''
    private indent = ''

    line(s?: string): void {
        if (s) {
            this.out += this.indent + s
        }
        this.out += '\n'
    }

    block(start: string, cb: () => void) {
        this.line(start + ' {')
        this.indent += '  '
        try {
            cb()
        } finally {
            this.indent = this.indent.slice(0, this.indent.length - 2)
        }
        this.line('}')
    }

    toString(): string {
        return this.out
    }
}


export function ensureArray<T>(item: T | T[]): T[] {
    return Array.isArray(item) ? item : [item]
}
