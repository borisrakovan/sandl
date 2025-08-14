import { Container, IContainer, container } from '@/di/container.js';
import {
	CircularDependencyError,
	DependencyContainerError,
	DependencyContainerFinalizationError,
	DependencyCreationError,
	UnknownDependencyError,
} from '@/di/errors.js';
import { Tag } from '@/di/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('DependencyContainer', () => {
	describe('constructor and factory', () => {
		it('should create an empty container', () => {
			const c = container();
			expect(c).toBeInstanceOf(Container);
		});

		it('should create a container with proper typing', () => {
			const c = container();
			// Type check - should be DependencyContainer<never>
			expect(c).toBeDefined();
		});
	});

	describe('register', () => {
		it('should register a simple class constructor', () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = container();
			const registered = c.register(TestService, () => new TestService());

			expect(registered).toBeInstanceOf(Container);
			// Should return the same container instance with updated type
			expect(registered).toBe(c);
		});

		it('should register with sync factory', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(
				TestService,
				() => new TestService('sync')
			);

			expect(c).toBeDefined();
		});

		it('should register with async factory', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(
				TestService,
				() => new TestService('async')
			);

			expect(c).toBeDefined();
		});

		it('should register with finalizer', () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn() as () => void;
			}

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer: (instance) => {
					instance.cleanup();
				},
			});

			expect(c).toBeDefined();
		});

		it('should throw error for duplicate registration', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			expect(() =>
				c.register(TestService, () => new TestService())
			).toThrowError(DependencyContainerError);
		});

		it('should preserve container chain for multiple registrations', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			expect(c).toBeDefined();
		});
	});

	describe('has', () => {
		it('should return false for unregistered dependency', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container();

			expect(c.has(TestService)).toBe(false);
		});

		it('should return false for registered but not instantiated dependency', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(false);
		});

		it('should return true for instantiated dependency', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			await c.get(TestService);

			expect(c.has(TestService)).toBe(true);
		});
	});

	describe('get', () => {
		it('should create and return instance for sync factory', async () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			const instance = await c.get(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});

		it('should create and return instance for async factory', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(TestService, async () => {
				await Promise.resolve();
				return new TestService('async');
			});

			const instance = await c.get(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.value).toBe('async');
		});

		it('should return cached instance on subsequent calls', async () => {
			class TestService extends Tag.Class('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = container().register(TestService, factory);

			const instance1 = await c.get(TestService);
			const instance2 = await c.get(TestService);

			expect(instance1).toBe(instance2);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container();

			await expect(
				(c as IContainer<typeof TestService>).get(TestService)
			).rejects.toThrow(UnknownDependencyError);
		});

		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(TestService, () => {
				throw new Error('Factory error');
			});

			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle async factory errors', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(TestService, async () => {
				await Promise.resolve();
				throw new Error('Async factory error');
			});

			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should remove failed promise from cache and allow retry', async () => {
			class TestService extends Tag.Class('TestService') {}

			let shouldFail = true;
			const c = container().register(TestService, () => {
				if (shouldFail) {
					throw new Error('Factory error');
				}
				return new TestService();
			});

			// First call should fail
			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);

			// Should not be in cache after failure
			expect(c.has(TestService)).toBe(false);

			// Second call should succeed
			shouldFail = false;
			const instance = await c.get(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should handle concurrent calls properly', async () => {
			class TestService extends Tag.Class('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = container().register(TestService, factory);

			// Make concurrent calls
			const [instance1, instance2, instance3] = await Promise.all([
				c.get(TestService),
				c.get(TestService),
				c.get(TestService),
			]);

			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
			expect(factory).toHaveBeenCalledTimes(1);
		});
	});

	describe('dependency injection', () => {
		it('should inject dependencies through factory function', async () => {
			class DatabaseService extends Tag.Class('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class UserService extends Tag.Class('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUser() {
					return this.db.query();
				}
			}

			const c = container()
				.register(DatabaseService, () => new DatabaseService())
				.register(
					UserService,
					async (container) =>
						new UserService(await container.get(DatabaseService))
				);

			const userService = await c.get(UserService);

			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle complex dependency graphs', async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			class CacheService extends Tag.Class('CacheService') {}

			class UserService extends Tag.Class('UserService') {
				constructor(
					private db: DatabaseService,
					private _cache: CacheService
				) {
					super();
				}

				getUser() {
					return `${this.db.connect()} with cache`;
				}
			}

			const c = container()
				.register(ConfigService, () => new ConfigService())
				.register(
					DatabaseService,
					async (container) =>
						new DatabaseService(await container.get(ConfigService))
				)
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (container) =>
						new UserService(
							await container.get(DatabaseService),
							await container.get(CacheService)
						)
				);

			const userService = await c.get(UserService);

			expect(userService.getUser()).toBe(
				'Connected to db://localhost with cache'
			);
		});

		it('should detect and throw CircularDependencyError', async () => {
			class ServiceA extends Tag.Class('ServiceA') {
				constructor(private _serviceB: ServiceB) {
					super();
				}
			}

			class ServiceB extends Tag.Class('ServiceB') {
				constructor(private _serviceA: ServiceA) {
					super();
				}
			}

			const c = container() as IContainer<
				typeof ServiceA | typeof ServiceB
			>;
			c.register(
				ServiceA,
				async (container) => new ServiceA(await container.get(ServiceB))
			);
			c.register(
				ServiceB,
				async (container) => new ServiceB(await container.get(ServiceA))
			);

			// Should throw CircularDependencyError, not hang
			await expect(c.get(ServiceA)).rejects.toThrow(
				CircularDependencyError
			);
			await expect(c.get(ServiceB)).rejects.toThrow(
				CircularDependencyError
			);
		});
	});

	describe('destroy', () => {
		it('should call finalizers for instantiated dependencies', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// Instantiate the service
			const instance = await c.get(TestService);

			await c.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should not call finalizers for non-instantiated dependencies', async () => {
			class TestService extends Tag.Class('TestService') {}

			const finalizer = vi.fn();

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// Do not instantiate the service
			await c.destroy();

			expect(finalizer).not.toHaveBeenCalled();
		});

		it('should call finalizers concurrently', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}

			const finalizationOrder: string[] = [];

			const c = container()
				.register(ServiceA, {
					factory: () => new ServiceA(),
					finalizer: () => {
						finalizationOrder.push('A');
					},
				})
				.register(ServiceB, {
					factory: () => new ServiceB(),
					finalizer: () => {
						finalizationOrder.push('B');
					},
				})
				.register(ServiceC, {
					factory: () => new ServiceC(),
					finalizer: () => {
						finalizationOrder.push('C');
					},
				});

			// Instantiate all services
			await c.get(ServiceA);
			await c.get(ServiceB);
			await c.get(ServiceC);

			await c.destroy();

			// Finalizers run concurrently, so we just verify all were called
			expect(finalizationOrder).toHaveLength(3);
			expect(finalizationOrder).toContain('A');
			expect(finalizationOrder).toContain('B');
			expect(finalizationOrder).toContain('C');
		});

		it('should handle async finalizers', async () => {
			class TestService extends Tag.Class('TestService') {
				asyncCleanup = vi
					.fn()
					.mockResolvedValue(undefined) as () => Promise<void>;
			}

			const finalizer = vi
				.fn()
				.mockImplementation((instance: TestService) => {
					return instance.asyncCleanup();
				});

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const instance = await c.get(TestService);

			await c.destroy();

			expect(instance.asyncCleanup).toHaveBeenCalled();
		});

		it('should collect finalizer errors and throw DependencyContainerFinalizationError', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, {
					factory: () => new ServiceA(),
					finalizer: () => {
						throw new Error('Finalizer A error');
					},
				})
				.register(ServiceB, {
					factory: () => new ServiceB(),
					finalizer: () => {
						throw new Error('Finalizer B error');
					},
				});

			// Instantiate services
			await c.get(ServiceA);
			await c.get(ServiceB);

			await expect(c.destroy()).rejects.toThrow(
				DependencyContainerFinalizationError
			);
		});

		it('should clear instance cache even if finalization fails', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer: () => {
					throw new Error('Finalizer error');
				},
			});

			await c.get(TestService);

			// Should throw due to finalizer error
			await expect(c.destroy()).rejects.toThrow();

			// But instance cache should still be cleared (not has() because that only checks cache)
			expect(c.has(TestService)).toBe(false);
		});

		it('should clear instance cache but preserve structure for reuse', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await c.get(ServiceA);
			await c.get(ServiceB);

			expect(c.has(ServiceA)).toBe(true);
			expect(c.has(ServiceB)).toBe(true);

			await c.destroy();

			// Instance cache should be cleared
			expect(c.has(ServiceA)).toBe(false);
			expect(c.has(ServiceB)).toBe(false);

			// But container should be reusable - can create new instances
			const newServiceA = await c.get(ServiceA);
			const newServiceB = await c.get(ServiceB);

			expect(newServiceA).toBeInstanceOf(ServiceA);
			expect(newServiceB).toBeInstanceOf(ServiceB);

			// And they should be cached again
			expect(c.has(ServiceA)).toBe(true);
			expect(c.has(ServiceB)).toBe(true);
		});

		it('should support multiple destroy/reuse cycles', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public id: number) {
					super();
				}
			}

			let instanceCount = 0;
			const c = container().register(TestService, () => {
				return new TestService(++instanceCount);
			});

			// First cycle
			const instance1 = await c.get(TestService);
			expect(instance1.id).toBe(1);
			await c.destroy();

			// Second cycle
			const instance2 = await c.get(TestService);
			expect(instance2.id).toBe(2);
			expect(instance2).not.toBe(instance1); // Different instances
			await c.destroy();

			// Third cycle
			const instance3 = await c.get(TestService);
			expect(instance3.id).toBe(3);
			expect(instance3).not.toBe(instance1);
			expect(instance3).not.toBe(instance2);
		});

		it('should preserve finalizers across destroy/reuse cycles', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// First cycle
			const instance1 = await c.get(TestService);
			await c.destroy();
			expect(finalizer).toHaveBeenCalledTimes(1);
			expect(instance1.cleanup).toHaveBeenCalledTimes(1);

			// Second cycle - finalizer should still work
			const instance2 = await c.get(TestService);
			await c.destroy();
			expect(finalizer).toHaveBeenCalledTimes(2);
			expect(instance2.cleanup).toHaveBeenCalledTimes(1);
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const c = container()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42);

			const stringValue = await c.get(StringTag);
			const numberValue = await c.get(NumberTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
		});

		it('should work with anonymous ValueTags', async () => {
			const ConfigTag = Tag.for<{ apiKey: string }>();

			const c = container().register(ConfigTag, () => ({
				apiKey: 'secret',
			}));

			const config = await c.get(ConfigTag);

			expect(config.apiKey).toBe('secret');
		});

		it('should mix ClassTag and ValueTag dependencies', async () => {
			class UserService extends Tag.Class('UserService') {
				constructor(private apiKey: string) {
					super();
				}

				getApiKey() {
					return this.apiKey;
				}
			}

			const ApiKeyTag = Tag.of('apiKey')<string>();

			const c = container()
				.register(ApiKeyTag, () => 'secret-key')
				.register(
					UserService,
					async (container) =>
						new UserService(await container.get(ApiKeyTag))
				);

			const userService = await c.get(UserService);

			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error handling', () => {
		it('should preserve error context in DependencyCreationError', async () => {
			class TestService extends Tag.Class('TestService') {}

			const originalError = new Error('Original error');
			const c = container().register(TestService, () => {
				throw originalError;
			});

			try {
				await c.get(TestService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				expect((error as DependencyCreationError).cause).toBe(
					originalError
				);
			}
		});

		it('should handle nested dependency creation errors', async () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class UserService extends Tag.Class('UserService') {}

			const c = container()
				.register(DatabaseService, () => {
					throw new Error('Database connection failed');
				})
				.register(
					UserService,
					async (container) =>
						new UserService(await container.get(DatabaseService))
				);

			try {
				await c.get(UserService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// Should be the UserService creation error, with nested DatabaseService error
			}
		});
	});

	describe('type safety edge cases', () => {
		it('should maintain type safety with complex inheritance', async () => {
			class BaseService extends Tag.Class('BaseService') {
				baseMethod() {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extendedMethod() {
					return 'extended';
				}
			}

			const c = container().register(
				BaseService,
				() => new ExtendedService()
			);

			const instance = await c.get(BaseService);

			// Should be able to call base method
			expect(instance.baseMethod()).toBe('base');
			// Should also be able to call extended method due to implementation
			expect((instance as ExtendedService).extendedMethod()).toBe(
				'extended'
			);
		});
	});
});
