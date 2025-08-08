import { PromiseOrValue } from '@/types.js';
import { DependencyContainer } from './container.js';
import { AnyTag } from './tag.js';

export interface ClassConstructor<T = unknown> {
	readonly name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T;
}

export type Factory<T, in TReg extends AnyTag> = (
	container: DependencyContainer<TReg>
) => PromiseOrValue<T>;

export type Finalizer<T> = (instance: T) => PromiseOrValue<void>;
