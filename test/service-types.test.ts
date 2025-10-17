import { container, IContainer } from '@/container.js';
import { Layer } from '@/layer.js';
import { service, Service } from '@/service.js';
import { Tag } from '@/tag.js';
import { Inject } from '@/types.js';
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

			const userService = service(UserService, async (container) => {
				// Container should have DatabaseService available
				expectTypeOf(container).toExtend<
					IContainer<typeof DatabaseService>
				>();

				const db = await container.get(DatabaseService);
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

			const userService = service(UserService, async (container) => {
				// Container should have all required dependencies available
				expectTypeOf(container).toExtend<
					IContainer<
						| typeof DatabaseService
						| typeof CacheService
						| typeof LoggerService
					>
				>();

				const [db, cache, logger] = await Promise.all([
					container.get(DatabaseService),
					container.get(CacheService),
					container.get(LoggerService),
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
		it('should compose services with .to() correctly', () => {
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
			const userService = service(UserService, async (container) => {
				const db = await container.get(DatabaseService);
				return new UserService(db);
			});

			const composedService = dbService.to(userService);

			// DatabaseService requirement should be satisfied by dbService
			expectTypeOf(composedService).toEqualTypeOf<
				Layer<never, typeof DatabaseService | typeof UserService>
			>();
		});

		it('should merge services with .and() correctly', () => {
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

			const mergedService = loggerService.and(cacheService);

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

			const dbService = service(DatabaseService, async (container) => {
				const external = await container.get(ExternalService);
				return new DatabaseService(external);
			});

			const userService = service(UserService, async (container) => {
				const [db, external] = await Promise.all([
					container.get(DatabaseService),
					container.get(ExternalService),
				]);
				return new UserService(db, external);
			});

			const composedService = dbService.to(userService);

			// ExternalService is still required (needed by both services)
			// DatabaseService requirement is satisfied by dbService
			expectTypeOf(composedService).branded.toEqualTypeOf<
				Layer<
					typeof ExternalService,
					typeof DatabaseService | typeof UserService
				>
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

			const dbService = service(DatabaseService, async (container) => {
				const config = await container.get(ConfigService);
				return new DatabaseService(config);
			});

			const repoService = service(UserRepository, async (container) => {
				const db = await container.get(DatabaseService);
				return new UserRepository(db);
			});

			const userService = service(UserService, async (container) => {
				const repo = await container.get(UserRepository);
				return new UserService(repo);
			});

			const fullService = configService
				.to(dbService)
				.to(repoService)
				.to(userService);

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

			const dbService = service(DatabaseService, async (container) => {
				const config = await container.get(ConfigService);
				return new DatabaseService(config);
			});

			const cacheService = service(CacheService, async (container) => {
				const config = await container.get(ConfigService);
				return new CacheService(config);
			});

			const userService = service(UserService, async (container) => {
				const [db, cache] = await Promise.all([
					container.get(DatabaseService),
					container.get(CacheService),
				]);
				return new UserService(db, cache);
			});

			// Build the diamond: Config -> (Database & Cache) -> User
			const infraLayer = configService.to(dbService.and(cacheService));
			const appLayer = infraLayer.to(userService);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<
					never,
					| typeof ConfigService
					| typeof DatabaseService
					| typeof CacheService
					| typeof UserService
				>
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

			expectTypeOf(testService.to).toEqualTypeOf<
				Layer<never, typeof TestService>['to']
			>();

			expectTypeOf(testService.and).toEqualTypeOf<
				Layer<never, typeof TestService>['and']
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
			const userService = service(UserService, async (container) => {
				const db = await container.get(DatabaseService);
				return new UserService(db);
			});

			const appService = dbService.to(userService);

			// Should be able to apply to a container
			const c = container();
			const finalContainer = appService.register(c);

			expectTypeOf(finalContainer).toEqualTypeOf<
				IContainer<typeof DatabaseService | typeof UserService>
			>();

			// Should be able to resolve services from the container
			expectTypeOf(finalContainer.get(DatabaseService)).toEqualTypeOf<
				Promise<DatabaseService>
			>();
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
			const serviceC = service(ServiceC, async (container) => {
				const b = await container.get(ServiceB);
				return new ServiceC(b);
			});

			// This composition should be allowed at type level but leave ServiceB unsatisfied
			const composed = serviceA.to(serviceC);

			// ServiceB should still be required
			expectTypeOf(composed).branded.toEqualTypeOf<
				Layer<typeof ServiceB, typeof ServiceA | typeof ServiceC>
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
			const dbService = service(DatabaseService, async (container) => {
				expectTypeOf(container).toExtend<
					IContainer<typeof DatabaseUrlTag>
				>();

				const url = await container.get(DatabaseUrlTag);
				expectTypeOf(url).toEqualTypeOf<string>();

				return new DatabaseService(url);
			});

			const composedService = dbUrlService.to(dbService);

			// No external dependencies required since dbUrlService provides what dbService needs
			expectTypeOf(composedService).toEqualTypeOf<
				Layer<never, typeof DatabaseUrlTag | typeof DatabaseService>
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

			const dbService = service(DatabaseService, async (container) => {
				// Container should require both ValueTags for manual injection - test key properties
				expectTypeOf(container.get).toBeFunction();
				expectTypeOf(container.has).toBeFunction();
				expectTypeOf(container.register).toBeFunction();
				expectTypeOf(container.destroy).toBeFunction();

				const config = await container.get(ConfigTag);
				const logger = await container.get(LoggerTag);
				return new DatabaseService(config, logger);
			});

			// Build complete layer
			const appLayer = configService.and(loggerService).to(dbService);

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<
					never,
					typeof ConfigTag | typeof LoggerTag | typeof DatabaseService
				>
			>();
		});
	});
});
