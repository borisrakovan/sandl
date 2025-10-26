import { container, IContainer } from '@/container.js';
import { Layer } from '@/layer.js';
import { service, Service } from '@/service.js';
import { Tag } from '@/tag.js';
import { Inject, ResolutionContext } from '@/types.js';
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
				Service<typeof LoggerService>
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
			expectTypeOf(userService).toEqualTypeOf<
				Service<typeof UserService>
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

			const composedService = dbService.provide(userService);

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

			const composedService = dbService.provide(userService);

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

			const fullService = configService
				.provide(dbService)
				.provide(repoService)
				.provide(userService);

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
			const infraLayer = configService.provide(
				dbService.merge(cacheService)
			);
			const appLayer = infraLayer.provide(userService);

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

			const appService = dbService.provide(userService);

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
			const composed = serviceA.provide(serviceC);

			// ServiceB should still be required
			// Only ServiceC is provided (target layer's provisions)
			expectTypeOf(composed).branded.toEqualTypeOf<
				Layer<typeof ServiceB, typeof ServiceC>
			>();
		});
	});

	describe('ValueTag service types', () => {
		it('should create service with correct layer type for ValueTag service', () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			const apiKeyService = service(ApiKeyTag, () => 'test-key');

			expectTypeOf(apiKeyService).toEqualTypeOf<
				Service<typeof ApiKeyTag>
			>();

			// ValueTag service should extend Layer with no requirements (never)
			expectTypeOf(apiKeyService).toExtend<
				Layer<never, typeof ApiKeyTag>
			>();
		});

		it('should compose ValueTag and ClassTag services correctly', () => {
			const DatabaseUrlTag = Tag.of('dbUrl')<string>();

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _url: Inject<typeof DatabaseUrlTag>) {
					super();
				}
			}

			const dbUrlService = service(
				DatabaseUrlTag,
				() => 'postgresql://localhost:5432'
			);
			const dbService = service(DatabaseService, async (ctx) => {
				expectTypeOf(ctx).toExtend<
					ResolutionContext<typeof DatabaseUrlTag>
				>();

				const url = await ctx.get(DatabaseUrlTag);
				expectTypeOf(url).toEqualTypeOf<string>();

				return new DatabaseService(url);
			});

			const composedService = dbUrlService.provide(dbService);

			// No external dependencies required since dbUrlService provides what dbService needs
			// Only DatabaseService is provided (target layer's provisions)
			expectTypeOf(composedService).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();
		});

		it('should handle mixed ValueTag/ClassTag dependency scenarios', () => {
			const ConfigTag = Tag.of('config')<{ dbUrl: string }>();
			const LoggerTag = Tag.of('logger')<{
				log: (msg: string) => void;
			}>();

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(
					private _config: Inject<typeof ConfigTag>,
					private _logger: Inject<typeof LoggerTag>
				) {
					super();
				}
			}

			const configService = service(ConfigTag, () => ({
				dbUrl: 'test',
			}));
			const loggerService = service(LoggerTag, () => ({
				log: (_msg: string) => {
					return;
				},
			}));

			const dbService = service(DatabaseService, async (ctx) => {
				// Container should require both ValueTags for manual injection - test key properties
				expectTypeOf(ctx.get).toBeFunction();

				const config = await ctx.get(ConfigTag);
				const logger = await ctx.get(LoggerTag);
				return new DatabaseService(config, logger);
			});

			// Build complete layer
			const appLayer = configService
				.merge(loggerService)
				.provide(dbService);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
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

			const composedService = dbService.provideMerge(userService);

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

			const composedService = dbService.provideMerge(userService);

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
			const withProvide = configService.provide(dbService);
			expectTypeOf(withProvide).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();

			// .provideMerge() exposes both layers' provisions
			const withProvideMerge = configService.provideMerge(dbService);
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

			const fullService = configService
				.provideMerge(dbService)
				.provideMerge(repoService)
				.provideMerge(userService);

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

		it('should work with ValueTag services', () => {
			const DatabaseUrlTag = Tag.of('dbUrl')<string>();
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private _url: Inject<typeof DatabaseUrlTag>) {
					super();
				}
			}

			const dbUrlService = service(
				DatabaseUrlTag,
				() => 'postgresql://localhost:5432'
			);
			const dbService = service(DatabaseService, async (ctx) => {
				const url = await ctx.get(DatabaseUrlTag);
				return new DatabaseService(url);
			});

			const composedService = dbUrlService.provideMerge(dbService);

			// Both ValueTag and ClassTag services should be provided
			expectTypeOf(composedService).toEqualTypeOf<
				Layer<never, typeof DatabaseUrlTag | typeof DatabaseService>
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
			const appService = configService
				.provideMerge(dbService)
				.provide(userService);

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

			const appService = dbService.provideMerge(userService);

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
});
