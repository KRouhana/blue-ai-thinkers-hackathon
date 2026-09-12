import { randomUUID } from 'node:crypto';

export type IdPrefix = 'ses' | 'cap' | 'int' | 'exp' | 'job' | 'evt' | 'op' | 'ws';

export const newId = (prefix: IdPrefix): string => `${prefix}_${randomUUID()}`;
