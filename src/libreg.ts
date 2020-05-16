
type REGOFF = number;

const MAGIC = 0x76644441;
const MAJOR_VERSIONS = [1];

enum RegisterType {
    KEY = 0x0001,
    ENTRY = 0x0010,
    ENTRY_STRING = 0x0011,
    ENTRY_INT32_ARRAY = 0x0012,
    ENTRY_BYTES = 0x0013,
    ENTRY_FILE = 0x0014,
    DELETED = 0x0080,
}

function removeTerminator(str: string) {
    const length = str.length;
    if (str.charCodeAt(length-1) === 0) {
        return str.substring(0, length-1);
    } else {
        return str;
    }
}

export function entryType(type: number):
    RegisterType.ENTRY_STRING | RegisterType.ENTRY_INT32_ARRAY | RegisterType.ENTRY_BYTES | RegisterType.ENTRY_FILE
{
    const low = type & 0x0ff;
    if (type === RegisterType.ENTRY_STRING) {
        return RegisterType.ENTRY_STRING;
    } else if (type === RegisterType.ENTRY_INT32_ARRAY) {
        return RegisterType.ENTRY_INT32_ARRAY;
    } else if (type === RegisterType.ENTRY_BYTES) {
        return RegisterType.ENTRY_BYTES;
    } else if (type === RegisterType.ENTRY_FILE) {
        return RegisterType.ENTRY_FILE;
    } else {
        throw new Error('invalid entry type: ' + type.toString(16));
    }
}

export function isEntry(type): boolean { // must be checked before checking if it is key
    return (type & RegisterType.ENTRY) !== 0;
}
export function isKey(type): boolean {
    return (type & RegisterType.KEY) !== 0;
}
export function isDeleted(type): boolean {
    return (type & RegisterType.DELETED) !== 0;
}

export abstract class Register {
    readonly name: string;
    readonly leftOffset: REGOFF;
    readonly parentOffset: REGOFF;
    readonly left: Register;
    protected constructor(readonly registry: Registry, readonly offset: REGOFF, readonly typeFlags: number) {
        if (arguments.length === 0) {
            return;
        }

        const nameOffset = registry.data.readUInt32LE(offset+4);
        const nameLength = registry.data.readUInt16LE(offset+8);
        this.name = removeTerminator(registry.data.subarray(nameOffset, nameOffset + nameLength).toString('utf8'));

        this.leftOffset = registry.data.readUInt32LE(offset+12);
        this.parentOffset = registry.data.readUInt32LE(offset+28);

        if (this.isDeleted()) {
            this.left = null;
        } else {
            if (this.leftOffset !== 0) {
                this.left = registry.readRegister(this.leftOffset);
            } else {
                this.left = null;
            }
        }
    }

    isDeleted(): boolean {
        return isDeleted(this.typeFlags);
    }
}

export class RegisterKey extends Register {
    readonly firstSubKeyOffset: REGOFF;
    readonly firstSubEntryOffset: REGOFF;
    private firstSubKey: RegisterKey;
    private firstSubEntry: RegisterValue;
    constructor(registry: Registry, offset: REGOFF, typeFlags: number) {
        super(registry, offset, typeFlags);
        this.firstSubKeyOffset = registry.data.readUInt32LE(offset+16);
        this.firstSubEntryOffset = registry.data.readUInt32LE(offset+20);

        if (this.isDeleted()) {
            this.firstSubKey = null;
            this.firstSubEntry = null;
        } else {
            if (this.firstSubKeyOffset !== 0) {
                this.firstSubKey = registry.readRegister(this.firstSubKeyOffset) as RegisterKey;
            } else {
                this.firstSubKey = null;
            }

            if (this.firstSubEntryOffset !== 0) {
                this.firstSubEntry = registry.readRegister(this.firstSubEntryOffset) as RegisterValue;
            } else {
                this.firstSubEntry = null;
            }
        }
    }

    scanChildKeys(): RegisterKey[] {
        const ret: RegisterKey[] = [];

        let next = this.firstSubKey;
        while (next != null) {
            ret.push(next);
            next = next.left as RegisterKey;
        }

        return ret;
    }

    scanChildValues(): RegisterValue[] {
        const ret: RegisterValue[] = [];

        let next = this.firstSubEntry;
        while (next != null) {
            ret.push(next);
            next = next.left as RegisterValue;
        }

        return ret;
    }

    toJSON(): {
        name: string,
        childKeys: RegisterKey[],
        childValues: RegisterValue[]
        deleted: boolean
    } {
        return {
            name: this.name,
            childKeys: this.scanChildKeys(),
            childValues: this.scanChildValues(),
            deleted: this.isDeleted()
        }
    }
}

export class RegisterValue extends Register {
    readonly value: string | Int32Array | Buffer | Error;
    readonly availableLength: number;
    constructor(registry: Registry, offset: REGOFF, typeFlags: number) {
        super(registry, offset, typeFlags);

        if (this.isDeleted()) {
        } else {
            this.availableLength = registry.data.readUInt32LE(offset + 16);

            const valueOffset = registry.data.readUInt32LE(offset+20);
            const valueLength = registry.data.readUInt32LE(offset+24);
            const valueBuffer = registry.data.subarray(valueOffset, valueOffset + valueLength);

            const type = entryType(typeFlags);
            if (type === RegisterType.ENTRY_STRING) {
                this.value = removeTerminator(valueBuffer.toString('utf8'));
            } else if(type === RegisterType.ENTRY_BYTES) {
                this.value = valueBuffer;
            } else if(type === RegisterType.ENTRY_INT32_ARRAY) {
                const length = valueLength / 4;
                this.value = new Int32Array(valueBuffer, 0, length);
            } else {
                this.value = new Error('unsupported type: ' + type.toString(16));
            }
        }
    }
    toJSON(): {
        name: string,
        value: string | null,
        deleted: boolean
    } {
        return {
            name: this.name,
            value: (() => {
                if (this.value == null) {
                    return null;
                } else if (this.value instanceof Buffer) {
                    return this.value.toString('hex');
                } else if(this.value instanceof Int32Array) {
                    return this.value.join(', ');
                } else if(this.value instanceof Error) {
                    return this.value.name + ' ' + this.value.message;
                } else if (typeof this.value === 'string') {
                    return this.value;
                } else {
                    return null;
                }
            }) (),
            deleted: this.isDeleted()
        }
    }
}

export class RegisterError extends Register {
    constructor(readonly message: string) {
        super(...([] as unknown as [null, 0, 0]));
    }
    toString(): string {
        return 'RegisterError(' + this.message + ')';
    }
    toJSON(): {
        error: string
    } {
        return {
            error: this.message
        }
    }
}

export class Registry {
    readonly rootObject: Register;
    private rootObjectOffset: REGOFF;
    constructor(readonly data: Buffer) {
        this.readHeader();
        this.rootObject = this.readRegister(this.rootObjectOffset);
    }

    readRegister(offset: number): Register {
        const offsetValidation = this.data.readUInt32LE(offset+0);

        if (offsetValidation !== offset) {
            return new RegisterError('invalid offset');
        }

        const type = this.data.readUInt16LE(offset+10);

        let register: Register;
        if (isEntry(type)) {
            register = new RegisterValue(this, offset, type);
        } else if (isKey(type)) {
            register = new RegisterKey(this, offset, type);
        } else {
            return new RegisterError('invalid type: ' + type.toString(16));
        }

        return register;
    }

    private readHeader() {
        const magic = this.data.readUInt32LE(0);
        if ( magic !== MAGIC) {
            throw new Error('not valid magic number: ' + magic.toString(16) + ', expected: ' + MAGIC.toString(16));
        }

        const majorVersion = this.data.readUInt16LE(4);
        if (!MAJOR_VERSIONS.includes(majorVersion)) {
            throw new Error('incompatible major version : ' + majorVersion + ', supported: ' + MAJOR_VERSIONS.join(', '));
        }
        const minorVersion = this.data.readUInt16LE(6);

        const nextAvailableOffset: REGOFF = this.data.readUInt32LE(8);
        this.rootObjectOffset = this.data.readUInt32LE(12);

    }
}
