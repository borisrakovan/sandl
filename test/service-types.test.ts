import { container, IContainer, ResolutionContext } from '@/container.js';
import { Layer } from '@/layer.js';
import { service } from '@/service.js';
import { Tag } from '@/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('Service Type Safety', () => {
	describe('basic service types', () => {
		it('should create service with correct layer type for simple service', () => {
			class LoggerService extends Tag.Class('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);

			expectTypeOf(loggerService).toEqualTypeOf<
				Layer<never, typeof LoggerService>
			>();

			// Service should extend Layer with correct types
			expectTypeOf(loggerService).toExtend<
				Layer<never, typeof LoggerService>
			>();
		});

		it('should create service with correct dependency requirements', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {
				query() {
					return [];
				}
			}

			class UserService extends Tag.Class('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const userService = service(UserService, async (ctx) => {
				// Container should have DatabaseService available
				expectTypeOf(ctx).toExtend<
					ResolutionContext<typeof DatabaseService>
				>();

				const db = await ctx.get(DatabaseService);
				expectTypeOf(db).toEqualTypeOf<DatabaseService>();

				return new UserService(db);
			});

			// Service should require DatabaseService and provide UserService
			expectTypeOf(userService).branded.toEqualTypeOf<
				Layer<typeof DatabaseService, typeof UserService>
			>();
			expectTypeOf(userService).toExtend<
				Layer<typeof DatabaseService, typeof UserService>
			>();
		});

		it('should handle complex multi-dependency services', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class CacheService extends Tag.Class('CacheService') {}
			class LoggerService extends Tag.Class('LoggerService') {}

			class UserService extends Tag.Class('UserService') {
				constructor(
					private _db: DatabaseService,
					private _cache: CacheService,
					private _logger: LoggerService
				) {
					super();
				}
			}

			const userService = service(UserService, async (ctx) => {
				// Container should have all required dependencies available
				expectTypeOf(ctx).toExtend<
					ResolutionContext<
						| typeof DatabaseService
						| typeof CacheService
						| typeof LoggerService
					>
				>();

				const [db, cache, logger] = await Promise.all([
					ctx.get(DatabaseService),
					ctx.get(CacheService),
					ctx.get(LoggerService),
				]);

				expectTypeOf(db).toEqualTypeOf<DatabaseService>();
				expectTypeOf(cache).toEqualTypeOf<CacheService>();
				expectTypeOf(logger).toEqualTypeOf<LoggerService>();

				return new UserService(db, cache, logger);
			});

			expectTypeOf(userService).toExtend<
				Layer<
					| typeof DatabaseService
					| typeof CacheService
					| typeof LoggerService,
					typeof UserService
				>
			>();
		});
	});

	describe('service composition', () => {
		it('should compose services with .provide() correctly', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}

			class UserService extends Tag.Class('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserService(db);
			});

			const composedService = userService.provide(dbService);

			// DatabaseService requirement should be satisfied by dbService
			// Only UserService is provided (target layer's provisions)
			expectTypeOf(composedService).toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should merge services with .merge() correctly', () => {
			class LoggerService extends Tag.Class('LoggerService') {}
			class CacheService extends Tag.Class('CacheService') {}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);
			const cacheService = service(
				CacheService,
				() => new CacheService()
			);

			const mergedService = loggerService.merge(cacheService);

			expectTypeOf(mergedService).toEqualTypeOf<
				Layer<never, typeof LoggerService | typeof CacheService>
			>();
		});

		it('should handle partial dependency satisfaction in composition', () => {
			class ExternalService extends Tag.Class('ExternalService') {}
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _external: ExternalService) {
					super();
				}
			}
			class UserService extends Tag.Class('UserService') {
				constructor(
					private _db: DatabaseService,
					private _external: ExternalService
				) {
					super();
				}
			}

			const dbService = service(DatabaseService, async (ctx) => {
				const external = await ctx.get(ExternalService);
				return new DatabaseService(external);
			});

			const userService = service(UserService, async (ctx) => {
				const [db, external] = await Promise.all([
					ctx.get(DatabaseService),
					ctx.get(ExternalService),
				]);
				return new UserService(db, external);
			});

			const composedService = userService.provide(dbService);

			// ExternalService is still required (needed by both services)
			// DatabaseService requirement is satisfied by dbService
			// Only UserService is provided (target layer's provisions)
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<typeof ExternalService, typeof UserService>
			>();
		});
	});

	describe('complex service scenarios', () => {
		it('should handle deep service dependency chains', () => {
			class ConfigService extends Tag.Class('ConfigService') {}

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			class UserRepository extends Tag.Class('UserRepository') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			class UserService extends Tag.Class('UserService') {
				constructor(private _repo: UserRepository) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);

			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.get(ConfigService);
				return new DatabaseService(config);
			});

			const repoService = service(UserRepository, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserRepository(db);
			});

			const userService = service(UserService, async (ctx) => {
				const repo = await ctx.get(UserRepository);
				return new UserService(repo);
			});

			const fullService = userService
				.provide(repoService)
				.provide(dbService)
				.provide(configService);

			// All dependencies should be satisfied, only final service provided
			expectTypeOf(fullService).toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should handle diamond dependency patterns', () => {
			class ConfigService extends Tag.Class('ConfigService') {}

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			class CacheService extends Tag.Class('CacheService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			class UserService extends Tag.Class('UserService') {
				constructor(
					private _db: DatabaseService,
					private _cache: CacheService
				) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);

			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.get(ConfigService);
				return new DatabaseService(config);
			});

			const cacheService = service(CacheService, async (ctx) => {
				const config = await ctx.get(ConfigService);
				return new CacheService(config);
			});

			const userService = service(UserService, async (ctx) => {
				const [db, cache] = await Promise.all([
					ctx.get(DatabaseService),
					ctx.get(CacheService),
				]);
				return new UserService(db, cache);
			});

			// Build the diamond: Config -> (Database & Cache) -> User
			const infraLayer = dbService
				.merge(cacheService)
				.provide(configService);
			const appLayer = userService.provide(infraLayer);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});
	});

	describe('service interface completeness', () => {
		it('should maintain all Layer methods', () => {
			class TestService extends Tag.Class('TestService') {}

			const testService = service(TestService, () => new TestService());

			// Should have all Layer methods
			expectTypeOf(testService.register).toEqualTypeOf<
				Layer<never, typeof TestService>['register']
			>();

			expectTypeOf(testService.provide).toEqualTypeOf<
				Layer<never, typeof TestService>['provide']
			>();

			expectTypeOf(testService.merge).toEqualTypeOf<
				Layer<never, typeof TestService>['merge']
			>();

			expectTypeOf(testService.provideMerge).toEqualTypeOf<
				Layer<never, typeof TestService>['provideMerge']
			>();
		});
	});

	describe('integration with container', () => {
		it('should integrate seamlessly with container registration', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}

			class UserService extends Tag.Class('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserService(db);
			});

			const appService = userService.provide(dbService);

			// Should be able to apply to a container
			const c = container();
			const finalContainer = appService.register(c);

			expectTypeOf(finalContainer).toEqualTypeOf<
				IContainer<typeof UserService>
			>();

			// Should be able to resolve services from the container
			expectTypeOf(finalContainer.get(UserService)).toEqualTypeOf<
				Promise<UserService>
			>();
		});
	});

	describe('error prevention at type level', () => {
		it('should prevent incorrect service composition at compile time', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {
				constructor(private _b: ServiceB) {
					super();
				}
			}

			const serviceA = service(ServiceA, () => new ServiceA());
			const serviceC = service(ServiceC, async (ctx) => {
				const b = await ctx.get(ServiceB);
				return new ServiceC(b);
			});

			// This composition should be allowed at type level but leave ServiceB unsatisfied
			const composed = serviceC.provide(serviceA);

			// ServiceB should still be required
			// Only ServiceC is provided (target layer's provisions)
			expectTypeOf(composed).branded.toEqualTypeOf<
				Layer<typeof ServiceB, typeof ServiceC>
			>();
		});
	});

	describe('service composition with "provideMerge"', () => {
		it("should compose services and expose both layers' provisions", () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class UserService extends Tag.Class('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserService(db);
			});

			const composedService = userService.provideMerge(dbService);

			// DatabaseService requirement should be satisfied by dbService
			// Both DatabaseService and UserService should be provided
			expectTypeOf(composedService).toEqualTypeOf<
				Layer<never, typeof DatabaseService | typeof UserService>
			>();
		});

		it('should preserve external requirements and expose both provisions', () => {
			class ExternalService extends Tag.Class('ExternalService') {}
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _external: ExternalService) {
					super();
				}
			}
			class UserService extends Tag.Class('UserService') {
				constructor(
					private _db: DatabaseService,
					private _external: ExternalService
				) {
					super();
				}
			}

			const dbService = service(DatabaseService, async (ctx) => {
				const external = await ctx.get(ExternalService);
				return new DatabaseService(external);
			});

			const userService = service(UserService, async (ctx) => {
				const [db, external] = await Promise.all([
					ctx.get(DatabaseService),
					ctx.get(ExternalService),
				]);
				return new UserService(db, external);
			});

			const composedService = userService.provideMerge(dbService);

			// ExternalService is still required (needed by both services)
			// Both DatabaseService and UserService should be provided
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<
					typeof ExternalService,
					typeof DatabaseService | typeof UserService
				>
			>();
		});

		it('should differ from .provide() in type signature', () => {
			class ConfigService extends Tag.Class('ConfigService') {}
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.get(ConfigService);
				return new DatabaseService(config);
			});

			// .provide() only exposes target layer's provisions
			const withProvide = dbService.provide(configService);
			expectTypeOf(withProvide).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();

			// .provideMerge() exposes both layers' provisions
			const withProvideMerge = dbService.provideMerge(configService);
			expectTypeOf(withProvideMerge).toEqualTypeOf<
				Layer<never, typeof ConfigService | typeof DatabaseService>
			>();
		});

		it('should handle deep service dependency chains with merged provisions', () => {
			class ConfigService extends Tag.Class('ConfigService') {}
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}
			class UserRepository extends Tag.Class('UserRepository') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}
			class UserService extends Tag.Class('UserService') {
				constructor(private _repo: UserRepository) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.get(ConfigService);
				return new DatabaseService(config);
			});
			const repoService = service(UserRepository, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserRepository(db);
			});
			const userService = service(UserService, async (ctx) => {
				const repo = await ctx.get(UserRepository);
				return new UserService(repo);
			});

			const fullService = userService.provideMerge(
				repoService.provideMerge(dbService).provideMerge(configService)
			);
			// All dependencies should be satisfied, all services provided
			expectTypeOf(fullService).toEqualTypeOf<
				Layer<
					never,
					| typeof ConfigService
					| typeof DatabaseService
					| typeof UserRepository
					| typeof UserService
				>
			>();
		});

		it('should handle mixed .provide() and .provideMerge() composition', () => {
			class ConfigService extends Tag.Class('ConfigService') {}
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _config: ConfigService) {
					super();
				}
			}
			class UserService extends Tag.Class('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const config = await ctx.get(ConfigService);
				return new DatabaseService(config);
			});
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserService(db);
			});

			// Use provideMerge to keep config available, then provide to hide intermediate services
			const appService = userService.provide(
				dbService.provide(configService)
			);

			expectTypeOf(appService).toEqualTypeOf<
				Layer<never, typeof UserService>
			>();
		});

		it('should integrate with container correctly for merged provisions', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class UserService extends Tag.Class('UserService') {
				constructor(private _db: DatabaseService) {
					super();
				}
			}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.get(DatabaseService);
				return new UserService(db);
			});

			const appService = userService.provideMerge(dbService);

			// Should be able to apply to a container
			const c = container();
			const finalContainer = appService.register(c);

			// Both services should be available in the final container
			expectTypeOf(finalContainer).toEqualTypeOf<
				IContainer<typeof DatabaseService | typeof UserService>
			>();

			// Should be able to resolve both services from the container
			expectTypeOf(finalContainer.get(DatabaseService)).toEqualTypeOf<
				Promise<DatabaseService>
			>();
			expectTypeOf(finalContainer.get(UserService)).toEqualTypeOf<
				Promise<UserService>
			>();
		});
	});

	describe('service with DependencySpec support', () => {
		it('should accept simple factory functions', () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}

			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);

			expectTypeOf(dbService).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();
		});

		it('should accept DependencyLifecycle objects with factory and finalizer', () => {
			class DatabaseConnection extends Tag.Class('DatabaseConnection') {
				disconnect() {
					return;
				}
			}

			const dbService = service(DatabaseConnection, {
				factory: () => new DatabaseConnection(),
				finalizer: (conn) => {
					conn.disconnect();
				},
			});

			expectTypeOf(dbService).toEqualTypeOf<
				Layer<never, typeof DatabaseConnection>
			>();
		});

		it('should support async factories and finalizers', () => {
			class AsyncResource extends Tag.Class('AsyncResource') {
				cleanup() {
					return Promise.resolve();
				}
			}

			const resourceService = service(AsyncResource, {
				factory: () => Promise.resolve(new AsyncResource()),
				finalizer: async (resource) => {
					await resource.cleanup();
				},
			});

			expectTypeOf(resourceService).toEqualTypeOf<
				Layer<never, typeof AsyncResource>
			>();
		});

		it('should work with services that have dependencies', () => {
			class Logger extends Tag.Class('Logger') {}
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private logger: Logger) {
					super();
				}
				close() {
					return;
				}
				getLogger() {
					return this.logger;
				}
			}

			const dbService = service(DatabaseService, {
				factory: async (ctx) => {
					const logger = await ctx.get(Logger);
					expectTypeOf(logger).toEqualTypeOf<Logger>();
					return new DatabaseService(logger);
				},
				finalizer: (db) => {
					db.close();
					db.getLogger(); // Use the logger to avoid unused warning
				},
			});

			expectTypeOf(dbService).branded.toEqualTypeOf<
				Layer<typeof Logger, typeof DatabaseService>
			>();
		});

		it('should maintain type safety in factory and finalizer parameters', () => {
			class CustomService extends Tag.Class('CustomService') {
				private value = 'test';
				getValue() {
					return this.value;
				}
				cleanup() {
					return;
				}
			}

			const customService = service(CustomService, {
				factory: () => {
					const instance = new CustomService();
					expectTypeOf(instance).toEqualTypeOf<CustomService>();
					expectTypeOf(instance.getValue).toEqualTypeOf<
						() => string
					>();
					return instance;
				},
				finalizer: (instance) => {
					expectTypeOf(instance).toEqualTypeOf<CustomService>();
					expectTypeOf(instance.getValue).toEqualTypeOf<
						() => string
					>();
					expectTypeOf(instance.cleanup).toEqualTypeOf<() => void>();
					instance.cleanup();
				},
			});

			expectTypeOf(customService).toEqualTypeOf<
				Layer<never, typeof CustomService>
			>();
		});
	});
});
