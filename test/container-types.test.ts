import { Container, IContainer, ResolutionContext } from '@/container.js';
import { Tag } from '@/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('DependencyContainer Type Safety', () => {
	describe('basic container types', () => {
		it('should start with never type for empty container', () => {
			const c = Container.empty();

			expectTypeOf(c).toEqualTypeOf<Container<never>>();
		});

		it('should add tag to union type when registering', () => {
			class ServiceA extends Tag.Service('ServiceA') {}

			const c = Container.empty().register(
				ServiceA,
				() => new ServiceA()
			);

			expectTypeOf(c).toEqualTypeOf<Container<typeof ServiceA>>();
		});

		it('should combine multiple tags in union type', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			expectTypeOf(c).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB>
			>();
		});
	});

	describe('get method type constraints', () => {
		it('should only allow getting registered dependencies', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			// Should return correct instance types for registered services
			expectTypeOf(c.get(ServiceA)).toEqualTypeOf<Promise<ServiceA>>();
			expectTypeOf(c.get(ServiceB)).toEqualTypeOf<Promise<ServiceB>>();
		});

		it('should prevent getting unregistered dependencies at compile time', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class UnregisteredService extends Tag.Service(
				'UnregisteredService'
			) {}

			const c = Container.empty().register(
				ServiceA,
				() => new ServiceA()
			);

			// This should cause a TypeScript error but we'll suppress it
			// @ts-expect-error - UnregisteredService is not in container type
			c.get(UnregisteredService).catch(() => {
				// Expected error - UnregisteredService not in container
			});
		});
	});

	describe('factory function constraints', () => {
		it('should provide correctly typed container to factory', () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserService extends Tag.Service('UserService') {}

			const c = Container.empty()
				.register(DatabaseService, () => new DatabaseService())
				.register(UserService, async (ctx) => {
					// Factory should receive correctly typed container
					expectTypeOf(ctx).toEqualTypeOf<
						ResolutionContext<typeof DatabaseService>
					>();

					// Should be able to get DatabaseService
					expectTypeOf(ctx.get(DatabaseService)).toEqualTypeOf<
						Promise<DatabaseService>
					>();

					// Should NOT be able to get UserService (circular dependency would be caught)
					// @ts-expect-error - UserService not available in factory container type
					await ctx.get(UserService);

					return new UserService();
				});

			expectTypeOf(c).toEqualTypeOf<
				Container<typeof DatabaseService | typeof UserService>
			>();
		});

		it('should enforce correct return type from factory', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			// Should accept correct return type
			const c1 = Container.empty().register(
				ServiceA,
				() => new ServiceA()
			);
			expectTypeOf(c1).toEqualTypeOf<Container<typeof ServiceA>>();

			// Should reject incorrect return type
			Container.empty().register(
				ServiceA,
				// @ts-expect-error - returning wrong type
				() => {
					return new ServiceB();
				}
			);
		});

		it('should support async factories', () => {
			class ServiceA extends Tag.Service('ServiceA') {}

			const c = Container.empty().register(ServiceA, async () => {
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

			const c = Container.empty()
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

			const c = Container.empty().register(DbConfigTag, () => ({
				host: 'localhost',
				port: 5432,
			}));

			expectTypeOf(c.get(DbConfigTag)).toEqualTypeOf<
				Promise<DatabaseConfig>
			>();
		});
	});

	describe('mixed tag types', () => {
		it('should handle mix of ServiceTag and ValueTag', () => {
			class UserService extends Tag.Service('UserService') {
				constructor(private apiKey: string) {
					super();
				}
			}
			const ApiKeyTag = Tag.of('apiKey')<string>();

			const c = Container.empty()
				.register(ApiKeyTag, () => 'secret-key')
				.register(UserService, async (ctx) => {
					const apiKey = await ctx.get(ApiKeyTag);
					expectTypeOf(apiKey).toEqualTypeOf<string>();
					return new UserService(apiKey);
				});

			expectTypeOf(c).toEqualTypeOf<
				Container<typeof ApiKeyTag | typeof UserService>
			>();
			expectTypeOf(c.get(UserService)).toEqualTypeOf<
				Promise<UserService>
			>();
		});
	});

	describe('inheritance and complex types', () => {
		it('should handle class inheritance correctly', () => {
			class BaseService extends Tag.Service('BaseService') {
				baseMethod(): string {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extendedMethod(): string {
					return 'extended';
				}
			}

			// Register with base service tag but extended implementation
			const c = Container.empty().register(
				BaseService,
				() => new ExtendedService()
			);

			// Should return BaseService type (the tag type, not implementation type)
			expectTypeOf(c.get(BaseService)).toEqualTypeOf<
				Promise<BaseService>
			>();
		});

		it('should handle generic service types', () => {
			class Repository<T> extends Tag.Service('Repository') {
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

			const c = Container.empty().register(
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
			class ServiceWithCleanup extends Tag.Service('ServiceWithCleanup') {
				cleanup(): void {
					return;
				}
			}

			// Should accept correct finalizer type
			const c1 = Container.empty().register(ServiceWithCleanup, {
				factory: () => new ServiceWithCleanup(),
				finalizer: (instance) => {
					expectTypeOf(instance).toEqualTypeOf<ServiceWithCleanup>();
					instance.cleanup();
				},
			});
			expectTypeOf(c1).toEqualTypeOf<
				Container<typeof ServiceWithCleanup>
			>();

			// Should reject incorrect finalizer type
			Container.empty().register(ServiceWithCleanup, {
				factory: () => new ServiceWithCleanup(),
				// @ts-expect-error - Should reject incorrect finalizer type
				finalizer: (instance: string) => {
					return instance.length;
				},
			});
		});

		it('should support async finalizers', () => {
			class ServiceWithAsyncCleanup extends Tag.Service(
				'ServiceWithAsyncCleanup'
			) {
				async cleanup(): Promise<void> {
					await Promise.resolve();
				}
			}

			const c = Container.empty().register(ServiceWithAsyncCleanup, {
				factory: () => new ServiceWithAsyncCleanup(),
				finalizer: async (instance) => {
					expectTypeOf(
						instance
					).toEqualTypeOf<ServiceWithAsyncCleanup>();
					await instance.cleanup();
				},
			});

			expectTypeOf(c).toEqualTypeOf<
				Container<typeof ServiceWithAsyncCleanup>
			>();
		});
	});

	describe('error type constraints', () => {
		it('should maintain type safety even with errors', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => {
					throw new Error('test');
				})
				.register(ServiceB, () => new ServiceB());

			// Even if ServiceA factory throws, the container type should still include it
			expectTypeOf(c).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB>
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
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserRepository extends Tag.Service('UserRepository') {}
			class UserService extends Tag.Service('UserService') {}
			class NotificationService extends Tag.Service(
				'NotificationService'
			) {}
			class AppService extends Tag.Service('AppService') {}

			const c = Container.empty()
				.register(ConfigService, () => new ConfigService())
				.register(DatabaseService, async (ctx) => {
					const config = await ctx.get(ConfigService);
					expectTypeOf(config).toEqualTypeOf<ConfigService>();
					return new DatabaseService();
				})
				.register(UserRepository, async (ctx) => {
					const db = await ctx.get(DatabaseService);
					expectTypeOf(db).toEqualTypeOf<DatabaseService>();
					return new UserRepository();
				})
				.register(UserService, async (ctx) => {
					const repo = await ctx.get(UserRepository);
					expectTypeOf(repo).toEqualTypeOf<UserRepository>();
					return new UserService();
				})
				.register(NotificationService, () => new NotificationService())
				.register(AppService, async (ctx) => {
					const userService = await ctx.get(UserService);
					const notificationService =
						await ctx.get(NotificationService);
					expectTypeOf(userService).toEqualTypeOf<UserService>();
					expectTypeOf(
						notificationService
					).toEqualTypeOf<NotificationService>();
					return new AppService();
				});

			expectTypeOf(c).toEqualTypeOf<
				Container<
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

	describe('merge method types', () => {
		it('should preserve type union when merging containers', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			const ApiKeyTag = Tag.of('apiKey')<string>();

			const source = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB())
				.register(ApiKeyTag, () => 'secret');

			const target = Container.empty();
			const result = source.merge(target);

			// Should return a new container with combined types
			expectTypeOf(result).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB | typeof ApiKeyTag>
			>();
		});

		it('should combine types when merging containers with existing registrations', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const source = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const target = Container.empty().register(
				ServiceC,
				() => new ServiceC()
			);

			const result = source.merge(target);

			expectTypeOf(result).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB | typeof ServiceC>
			>();
		});

		it('should work with ValueTag types', () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();
			class ServiceA extends Tag.Service('ServiceA') {}

			const source = Container.empty()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42);

			const target = Container.empty().register(
				ServiceA,
				() => new ServiceA()
			);

			const result = source.merge(target);

			expectTypeOf(result).toEqualTypeOf<
				Container<typeof StringTag | typeof NumberTag | typeof ServiceA>
			>();
		});

		it('should work with empty source container', () => {
			class ServiceA extends Tag.Service('ServiceA') {}

			const source = Container.empty();
			const target = Container.empty().register(
				ServiceA,
				() => new ServiceA()
			);

			const result = source.merge(target);

			expectTypeOf(result).toEqualTypeOf<Container<typeof ServiceA>>();
		});

		it('should work with empty target container', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const source = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const target = Container.empty();
			const result = source.merge(target);

			expectTypeOf(result).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB>
			>();
		});
	});

	describe('container variance', () => {
		it('should support contravariance for both IContainer and Container', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			// Create containers with specific types
			const containerA = Container.empty().register(
				ServiceA,
				() => new ServiceA()
			);
			const containerAB = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			// CONTRAVARIANCE TESTS: These should work
			// A container with more dependencies can be used where fewer are expected

			// IContainer contravariance
			const iContainerContravariant: IContainer<typeof ServiceA> =
				containerAB;
			expectTypeOf(iContainerContravariant).toEqualTypeOf<
				IContainer<typeof ServiceA>
			>();

			// Container contravariance (should work now with 'in TReg')
			const containerContravariant: Container<typeof ServiceA> =
				containerAB;
			expectTypeOf(containerContravariant).toEqualTypeOf<
				Container<typeof ServiceA>
			>();

			// COVARIANCE TESTS: These should fail with contravariance
			// A container with fewer dependencies should NOT be usable where more are expected

			// @ts-expect-error - Should fail: ServiceA container cannot be used as ServiceA | ServiceB interface
			const _iContainerCovariant: IContainer<
				typeof ServiceA | typeof ServiceB
			> = containerA;

			// @ts-expect-error - Should fail: ServiceA container cannot be used as ServiceA | ServiceB container
			const _containerCovariant: Container<
				typeof ServiceA | typeof ServiceB
			> = containerA;

			// Type assertions for the original containers
			expectTypeOf(containerA).toEqualTypeOf<
				Container<typeof ServiceA>
			>();
			expectTypeOf(containerAB).toEqualTypeOf<
				Container<typeof ServiceA | typeof ServiceB>
			>();

			// Verify that contravariant assignments preserve the expected interface
			expectTypeOf(iContainerContravariant).toEqualTypeOf<
				IContainer<typeof ServiceA>
			>();
			expectTypeOf(containerContravariant).toEqualTypeOf<
				Container<typeof ServiceA>
			>();
		});

		it('should demonstrate practical contravariance usage', () => {
			class ConfigService extends Tag.Service('ConfigService') {}
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class LoggerService extends Tag.Service('LoggerService') {}

			// Full application container with all services
			const appContainer = Container.empty()
				.register(ConfigService, () => new ConfigService())
				.register(DatabaseService, () => new DatabaseService())
				.register(LoggerService, () => new LoggerService());

			// Function that only needs config - contravariance allows passing the full container
			function useConfigOnly(container: Container<typeof ConfigService>) {
				expectTypeOf(container).toEqualTypeOf<
					Container<typeof ConfigService>
				>();
				// This function can only access ConfigService
			}

			// Function that needs config and database
			function useConfigAndDb(
				container: Container<
					typeof ConfigService | typeof DatabaseService
				>
			) {
				expectTypeOf(container).toEqualTypeOf<
					Container<typeof ConfigService | typeof DatabaseService>
				>();
				// This function can access both ConfigService and DatabaseService
			}

			// Contravariance in action: we can pass the full app container to functions expecting subsets
			useConfigOnly(appContainer); // Works! appContainer has ConfigService (and more)
			useConfigAndDb(appContainer); // Works! appContainer has both ConfigService and DatabaseService (and more)

			// This should fail - we can't pass a container with fewer services
			const configOnlyContainer = Container.empty().register(
				ConfigService,
				() => new ConfigService()
			);

			// @ts-expect-error - Cannot pass container with only ConfigService to function expecting ConfigService | DatabaseService
			useConfigAndDb(configOnlyContainer);
		});
	});
});
