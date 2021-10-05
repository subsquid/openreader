import assert from "assert"
import {pluralize, underscore} from "inflected"


export {pluralize}


export function snakeCase(name: string): string {
    return underscore(name)
}


export function lowerCaseFirst(s: string): string {
    if (s) {
        return s[0].toLowerCase() + s.slice(1)
    } else {
        return s
    }
}


export function upperCaseFirst(s: string): string {
    if (s) {
        return s[0].toUpperCase() + s.slice(1)
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


export function ensureArray<T>(item: T | T[]): T[] {
    return Array.isArray(item) ? item : [item]
}


export function unsupportedCase(value: string): Error {
    return new Error(`Unsupported case: ${value}`)
}


export function toInt(val: number | string): number {
    let i = parseInt(val as string)
    assert(!isNaN(i) && isFinite(i))
    return i
}


export class Output {
    private out: (string | {indent: string, gen: () => string[]})[] = []
    private indent = ''

    line(s?: string): void {
        if (s) {
            this.out.push(this.indent + s)
        } else {
            this.out.push('')
        }
    }

    block(start: string, cb: () => void): void {
        this.line(start + ' {')
        this.indent += '  '
        try {
            cb()
        } finally {
            this.indent = this.indent.slice(0, this.indent.length - 2)
        }
        this.line('}')
    }

    lazy(gen: () => string[]): void {
        this.out.push({indent: this.indent, gen})
    }

    toString(): string {
        let out = ''
        for (let i = 0; i < this.out.length; i++) {
            let line = this.out[i]
            if (typeof line == 'string') {
                out += line + '\n'
            } else {
                let lazy = line
                lazy.gen().forEach(s => {
                    if (s) {
                        out += lazy.indent + s + '\n'
                    } else {
                        out += '\n'
                    }
                })
            }
        }
        return out
    }
}
