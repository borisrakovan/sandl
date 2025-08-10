import { DependencyContainer, container } from '@/di/container.js';
import { Tag } from '@/di/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('DependencyContainer Type Safety', () => {
	describe('basic container types', () => {
		it('should start with never type for empty container', () => {
			const c = container();

			expectTypeOf(c).toEqualTypeOf<DependencyContainer<never>>();
		});

		it('should add tag to union type when registering', () => {
			class ServiceA extends Tag.Class('ServiceA') {}

			const c = container().register(ServiceA, () => new ServiceA());

			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<typeof ServiceA>
			>();
		});

		it('should combine multiple tags in union type', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<typeof ServiceA | typeof ServiceB>
			>();
		});
	});

	describe('get method type constraints', () => {
		it('should only allow getting registered dependencies', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			// Should return correct instance types for registered services
			expectTypeOf(c.get(ServiceA)).toEqualTypeOf<Promise<ServiceA>>();
			expectTypeOf(c.get(ServiceB)).toEqualTypeOf<Promise<ServiceB>>();
		});

		it('should prevent getting unregistered dependencies at compile time', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class UnregisteredService extends Tag.Class(
				'UnregisteredService'
			) {}

			const c = container().register(ServiceA, () => new ServiceA());

			// This should cause a TypeScript error but we'll suppress it
			// @ts-expect-error - UnregisteredService is not in container type
			c.get(UnregisteredService).catch(() => {
				// Expected error - UnregisteredService not in container
			});
		});
	});

	describe('factory function constraints', () => {
		it('should provide correctly typed container to factory', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class UserService extends Tag.Class('UserService') {}

			const c = container()
				.register(DatabaseService, () => new DatabaseService())
				.register(UserService, async (container) => {
					// Factory should receive correctly typed container
					expectTypeOf(container).toEqualTypeOf<
						DependencyContainer<typeof DatabaseService>
					>();

					// Should be able to get DatabaseService
					expectTypeOf(container.get(DatabaseService)).toEqualTypeOf<
						Promise<DatabaseService>
					>();

					// Should NOT be able to get UserService (circular dependency would be caught)
					// @ts-expect-error - UserService not available in factory container type
					await container.get(UserService);

					return new UserService();
				});

			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<typeof DatabaseService | typeof UserService>
			>();
		});

		it('should enforce correct return type from factory', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			// Should accept correct return type
			const c1 = container().register(ServiceA, () => new ServiceA());
			expectTypeOf(c1).toEqualTypeOf<
				DependencyContainer<typeof ServiceA>
			>();

			// Should reject incorrect return type
			container().register(
				ServiceA,
				// @ts-expect-error - returning wrong type
				() => {
					return new ServiceB();
				}
			);
		});

		it('should support async factories', () => {
			class ServiceA extends Tag.Class('ServiceA') {}

			const c = container().register(ServiceA, async () => {
				await Promise.resolve();
				return new ServiceA();
			});

			expectTypeOf(c.get(ServiceA)).toEqualTypeOf<Promise<ServiceA>>();
		});
	});

	describe('ValueTag type constraints', () => {
		it('should work with strongly typed value tags', () => {
			const StringConfigTag = Tag.of('stringConfig')<string>();
			const NumberConfigTag = Tag.of('numberConfig')<number>();
			interface ComplexConfig {
				apiKey: string;
				timeout: number;
			}
			const ComplexConfigTag = Tag.of('complexConfig')<ComplexConfig>();

			const c = container()
				.register(StringConfigTag, () => 'hello')
				.register(NumberConfigTag, () => 42)
				.register(ComplexConfigTag, () => ({
					apiKey: 'key',
					timeout: 1000,
				}));

			// Should return correct types
			expectTypeOf(c.get(StringConfigTag)).toEqualTypeOf<
				Promise<string>
			>();
			expectTypeOf(c.get(NumberConfigTag)).toEqualTypeOf<
				Promise<number>
			>();
			expectTypeOf(c.get(ComplexConfigTag)).toEqualTypeOf<
				Promise<ComplexConfig>
			>();
		});

		it('should work with anonymous value tags', () => {
			interface DatabaseConfig {
				host: string;
				port: number;
			}
			const DbConfigTag = Tag.for<DatabaseConfig>();

			const c = container().register(DbConfigTag, () => ({
				host: 'localhost',
				port: 5432,
			}));

			expectTypeOf(c.get(DbConfigTag)).toEqualTypeOf<
				Promise<DatabaseConfig>
			>();
		});
	});

	describe('mixed tag types', () => {
		it('should handle mix of ClassTag and ValueTag', () => {
			class UserService extends Tag.Class('UserService') {
				constructor(private apiKey: string) {
					super();
				}
			}
			const ApiKeyTag = Tag.of('apiKey')<string>();

			const c = container()
				.register(ApiKeyTag, () => 'secret-key')
				.register(UserService, async (container) => {
					const apiKey = await container.get(ApiKeyTag);
					expectTypeOf(apiKey).toEqualTypeOf<string>();
					return new UserService(apiKey);
				});

			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<typeof ApiKeyTag | typeof UserService>
			>();
			expectTypeOf(c.get(UserService)).toEqualTypeOf<
				Promise<UserService>
			>();
		});
	});

	describe('inheritance and complex types', () => {
		it('should handle class inheritance correctly', () => {
			class BaseService extends Tag.Class('BaseService') {
				baseMethod(): string {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extendedMethod(): string {
					return 'extended';
				}
			}

			// Register with base class tag but extended implementation
			const c = container().register(
				BaseService,
				() => new ExtendedService()
			);

			// Should return BaseService type (the tag type, not implementation type)
			expectTypeOf(c.get(BaseService)).toEqualTypeOf<
				Promise<BaseService>
			>();
		});

		it('should handle generic service types', () => {
			class Repository<T> extends Tag.Class('Repository') {
				constructor(private entityType: new () => T) {
					super();
				}
				create(): T {
					return new this.entityType();
				}
			}

			class User {
				name = '';
			}

			const c = container().register(
				Repository,
				() => new Repository(User)
			);

			expectTypeOf(c.get(Repository)).toEqualTypeOf<
				Promise<Repository<unknown>>
			>();
		});
	});

	describe('finalizer type constraints', () => {
		it('should enforce correct finalizer parameter type', () => {
			class ServiceWithCleanup extends Tag.Class('ServiceWithCleanup') {
				cleanup(): void {
					return;
				}
			}

			// Should accept correct finalizer type
			const c1 = container().register(
				ServiceWithCleanup,
				() => new ServiceWithCleanup(),
				(instance) => {
					expectTypeOf(instance).toEqualTypeOf<ServiceWithCleanup>();
					instance.cleanup();
				}
			);
			expectTypeOf(c1).toEqualTypeOf<
				DependencyContainer<typeof ServiceWithCleanup>
			>();

			// Should reject incorrect finalizer type
			container().register(
				ServiceWithCleanup,
				() => new ServiceWithCleanup(),
				// @ts-expect-error - wrong parameter type
				(instance: string) => {
					return instance.length;
				}
			);
		});

		it('should support async finalizers', () => {
			class ServiceWithAsyncCleanup extends Tag.Class(
				'ServiceWithAsyncCleanup'
			) {
				async cleanup(): Promise<void> {
					await Promise.resolve();
				}
			}

			const c = container().register(
				ServiceWithAsyncCleanup,
				() => new ServiceWithAsyncCleanup(),
				async (instance) => {
					expectTypeOf(
						instance
					).toEqualTypeOf<ServiceWithAsyncCleanup>();
					await instance.cleanup();
				}
			);

			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<typeof ServiceWithAsyncCleanup>
			>();
		});
	});

	describe('error type constraints', () => {
		it('should maintain type safety even with errors', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => {
					throw new Error('test');
				})
				.register(ServiceB, () => new ServiceB());

			// Even if ServiceA factory throws, the container type should still include it
			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<typeof ServiceA | typeof ServiceB>
			>();

			// And get should still return the correct Promise type (even though it will reject)
			// We catch the error to prevent test suite failure
			c.get(ServiceA).catch(() => {
				// Expected error - factory throws
			});
			expectTypeOf<
				ReturnType<typeof c.get<typeof ServiceA>>
			>().toEqualTypeOf<Promise<ServiceA>>();
		});
	});

	describe('complex dependency graphs', () => {
		it('should handle multi-level dependency chains', () => {
			class ConfigService extends Tag.Class('ConfigService') {}
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class UserRepository extends Tag.Class('UserRepository') {}
			class UserService extends Tag.Class('UserService') {}
			class NotificationService extends Tag.Class(
				'NotificationService'
			) {}
			class AppService extends Tag.Class('AppService') {}

			const c = container()
				.register(ConfigService, () => new ConfigService())
				.register(DatabaseService, async (container) => {
					const config = await container.get(ConfigService);
					expectTypeOf(config).toEqualTypeOf<ConfigService>();
					return new DatabaseService();
				})
				.register(UserRepository, async (container) => {
					const db = await container.get(DatabaseService);
					expectTypeOf(db).toEqualTypeOf<DatabaseService>();
					return new UserRepository();
				})
				.register(UserService, async (container) => {
					const repo = await container.get(UserRepository);
					expectTypeOf(repo).toEqualTypeOf<UserRepository>();
					return new UserService();
				})
				.register(NotificationService, () => new NotificationService())
				.register(AppService, async (container) => {
					const userService = await container.get(UserService);
					const notificationService =
						await container.get(NotificationService);
					expectTypeOf(userService).toEqualTypeOf<UserService>();
					expectTypeOf(
						notificationService
					).toEqualTypeOf<NotificationService>();
					return new AppService();
				});

			expectTypeOf(c).toEqualTypeOf<
				DependencyContainer<
					| typeof ConfigService
					| typeof DatabaseService
					| typeof UserRepository
					| typeof UserService
					| typeof NotificationService
					| typeof AppService
				>
			>();
		});
	});
});
