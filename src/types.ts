export type PromiseOrValue<T> = T | Promise<T>;

export type Contravariant<A> = (_: A) => void;
export type Covariant<A> = (_: never) => A;
export type Invariant<A> = (_: A) => A;
