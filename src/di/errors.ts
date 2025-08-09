import { BaseError } from '@/errors.js';
import { AnyTag, Tag } from './tag.js';

export class DependencyContainerError extends BaseError {}

export class UnknownDependencyError extends DependencyContainerError {
	constructor(tag: AnyTag) {
		super(`No factory registered for dependency ${Tag.id(tag)}`);
	}
}

export class DependencyCreationError extends DependencyContainerError {
	constructor(tag: AnyTag, error: unknown) {
		super(`Error creating instance of ${Tag.id(tag)}: ${error}`, {
			cause: error,
			detail: {
				tag: Tag.id(tag),
			},
		});
	}
}

export class DependencyContainerFinalizationError extends DependencyContainerError {
	constructor(errors: unknown[]) {
		const lambdaErrors = errors.map((error) => BaseError.ensure(error));
		super('Error destroying dependency container', {
			cause: errors[0],
			detail: {
				errors: lambdaErrors.map((error) => error.dump()),
			},
		});
	}
}
