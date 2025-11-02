import { Container } from '@/container.js';
import { layer, Layer } from '@/layer.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('Layer', () => {
	describe('layer factory', () => {
		it('should create a simple layer without parameters', () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const testLayer = layer<never, typeof TestService>((container) =>
				container.register(TestService, () => new TestService())
			);

			const layerInstance = testLayer;
			expect(layerInstance).toBeDefined();
			expect(layerInstance.register).toBeDefined();
			expect(layerInstance.provide).toBeDefined();
			expect(layerInstance.merge).toBeDefined();
		});

		it('should register services correctly', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const testLayer = layer<never, typeof TestService>((container) =>
				container.register(TestService, () => new TestService())
			);

			const container = Container.empty();
			const updatedContainer = testLayer.register(container);

			const instance = await updatedContainer.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});
	});

	describe('layer composition with "provide"', () => {
		it('should compose layers where source provides dependencies to target', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUser() {
					return this.db.query();
				}
			}

			const databaseLayer = layer<never, typeof DatabaseService>(
				(container) =>
					container.register(
						DatabaseService,
						() => new DatabaseService()
					)
			);

			const userLayer = layer<typeof DatabaseService, typeof UserService>(
				(container) =>
					container.register(
						UserService,
						async (ctx) =>
							new UserService(await ctx.resolve(DatabaseService))
					)
			);

			const composedLayer = userLayer.provide(databaseLayer);

			const container = Container.empty();
			const finalContainer = composedLayer.register(container);

			const userService = await finalContainer.resolve(UserService);
			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle multi-level composition', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUser() {
					return this.db.connect();
				}
			}

			const configLayer = layer<never, typeof ConfigService>(
				(container) =>
					container.register(ConfigService, () => new ConfigService())
			);

			const databaseLayer = layer<
				typeof ConfigService,
				typeof DatabaseService
			>((container) =>
				container.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
			);

			const userLayer = layer<typeof DatabaseService, typeof UserService>(
				(container) =>
					container.register(
						UserService,
						async (ctx) =>
							new UserService(await ctx.resolve(DatabaseService))
					)
			);

			const finalLayer = userLayer
				.provide(databaseLayer)
				.provide(configLayer);

			const container = Container.empty();
			const finalContainer = finalLayer.register(container);

			const userService = await finalContainer.resolve(UserService);
			expect(userService.getUser()).toBe('Connected to db://localhost');
		});

		it('should handle external dependencies in composition', async () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			class DatabaseService extends Tag.Service('DatabaseService') {}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private apiKey: string,
					private _db: DatabaseService
				) {
					super();
				}

				getApiKey() {
					return this.apiKey;
				}
			}

			const databaseLayer = layer<never, typeof DatabaseService>(
				(container) =>
					container.register(
						DatabaseService,
						() => new DatabaseService()
					)
			);

			const userLayer = layer<
				typeof ApiKeyTag | typeof DatabaseService,
				typeof UserService
			>((container) =>
				container.register(
					UserService,
					async (ctx) =>
						new UserService(
							await ctx.resolve(ApiKeyTag),
							await ctx.resolve(DatabaseService)
						)
				)
			);

			const composedLayer = userLayer.provide(databaseLayer);

			// Pre-register the API key dependency
			const container = Container.empty().register(
				ApiKeyTag,
				() => 'secret-key'
			);
			const finalContainer = composedLayer.register(container);

			const userService = await finalContainer.resolve(UserService);
			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('layer composition with "provideMerge"', () => {
		it("should compose layers and expose both layers' provisions", async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getConfig() {
					return 'config-value';
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected with ${this.config.getConfig()}`;
				}
			}

			const configLayer = layer<never, typeof ConfigService>(
				(container) =>
					container.register(ConfigService, () => new ConfigService())
			);

			const databaseLayer = layer<
				typeof ConfigService,
				typeof DatabaseService
			>((container) =>
				container.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
			);

			const infraLayer = databaseLayer.provideMerge(configLayer);

			const container = Container.empty();
			const finalContainer = infraLayer.register(container);

			// Both services should be available
			const config = await finalContainer.resolve(ConfigService);
			const database = await finalContainer.resolve(DatabaseService);

			expect(config.getConfig()).toBe('config-value');
			expect(database.connect()).toBe('Connected with config-value');
		});

		it('should differ from .provide() by exposing source layer provisions', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getValue() {
					return 'config';
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				getValue() {
					return `db-${this.config.getValue()}`;
				}
			}

			const configLayer = layer<never, typeof ConfigService>(
				(container) =>
					container.register(ConfigService, () => new ConfigService())
			);

			const databaseLayer = layer<
				typeof ConfigService,
				typeof DatabaseService
			>((container) =>
				container.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
			);

			// .provide() only exposes target layer's provisions
			const withProvide = databaseLayer.provide(configLayer);
			const provideContainer = withProvide.register(Container.empty());

			// Should have DatabaseService but not ConfigService directly accessible
			const db1 = await provideContainer.resolve(DatabaseService);
			expect(db1.getValue()).toBe('db-config');

			// .provideMerge() exposes both layers' provisions
			const withProvideMerge = databaseLayer.provideMerge(configLayer);
			const provideMergeContainer = withProvideMerge.register(
				Container.empty()
			);

			// Should have both services accessible
			const config = await provideMergeContainer.resolve(ConfigService);
			const db2 = await provideMergeContainer.resolve(DatabaseService);

			expect(config.getValue()).toBe('config');
			expect(db2.getValue()).toBe('db-config');
		});
	});

	describe('layer merging with "merge"', () => {
		it('should merge two independent layers', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}

			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const mergedLayer = layerA.merge(layerB);

			const container = Container.empty();
			const finalContainer = mergedLayer.register(container);

			const serviceA = await finalContainer.resolve(ServiceA);
			const serviceB = await finalContainer.resolve(ServiceB);

			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should merge layers with shared dependencies', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getConfig() {
					return 'config';
				}
			}

			class ServiceA extends Tag.Service('ServiceA') {
				constructor(private config: ConfigService) {
					super();
				}

				getValue() {
					return `A-${this.config.getConfig()}`;
				}
			}

			class ServiceB extends Tag.Service('ServiceB') {
				constructor(private config: ConfigService) {
					super();
				}

				getValue() {
					return `B-${this.config.getConfig()}`;
				}
			}

			const configLayer = layer<never, typeof ConfigService>(
				(container) =>
					container.register(ConfigService, () => new ConfigService())
			);

			const serviceLayerA = layer<typeof ConfigService, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) =>
							new ServiceA(await ctx.resolve(ConfigService))
					)
			);

			const serviceLayerB = layer<typeof ConfigService, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) =>
							new ServiceB(await ctx.resolve(ConfigService))
					)
			);

			// First register config, then merge the service layers
			const baseLayer = configLayer;
			const mergedServices = serviceLayerA.merge(serviceLayerB);
			const finalLayer = mergedServices.provide(baseLayer);

			const container = Container.empty();
			const finalContainer = finalLayer.register(container);

			const serviceA = await finalContainer.resolve(ServiceA);
			const serviceB = await finalContainer.resolve(ServiceB);

			expect(serviceA.getValue()).toBe('A-config');
			expect(serviceB.getValue()).toBe('B-config');
		});

		it('should handle complex merging scenarios', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class CacheService extends Tag.Service('CacheService') {}
			class EmailService extends Tag.Service('EmailService') {}
			class LoggingService extends Tag.Service('LoggingService') {}

			const persistenceLayer = layer<
				never,
				typeof DatabaseService | typeof CacheService
			>((container) =>
				container
					.register(DatabaseService, () => new DatabaseService())
					.register(CacheService, () => new CacheService())
			);

			const communicationLayer = layer<never, typeof EmailService>(
				(container) =>
					container.register(EmailService, () => new EmailService())
			);

			const observabilityLayer = layer<never, typeof LoggingService>(
				(container) =>
					container.register(
						LoggingService,
						() => new LoggingService()
					)
			);

			const infraLayer = persistenceLayer
				.merge(communicationLayer)
				.merge(observabilityLayer);

			const container = Container.empty();
			const finalContainer = infraLayer.register(container);

			const db = await finalContainer.resolve(DatabaseService);
			const cache = await finalContainer.resolve(CacheService);
			const email = await finalContainer.resolve(EmailService);
			const logging = await finalContainer.resolve(LoggingService);

			expect(db).toBeInstanceOf(DatabaseService);
			expect(cache).toBeInstanceOf(CacheService);
			expect(email).toBeInstanceOf(EmailService);
			expect(logging).toBeInstanceOf(LoggingService);
		});
	});

	describe('Layer utilities', () => {
		it('should create empty layer', () => {
			const emptyLayer = Layer.empty();

			const container = Container.empty();
			const result = emptyLayer.register(container);

			expect(result).toBe(container); // Should be the same container
		});

		it('should merge multiple layers with Layer.mergeAll', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const layerC = layer<never, typeof ServiceC>((container) =>
				container.register(ServiceC, () => new ServiceC())
			);

			const mergedLayer = Layer.mergeAll(layerA, layerB, layerC);

			const container = Container.empty();
			const finalContainer = mergedLayer.register(container);

			const serviceA = await finalContainer.resolve(ServiceA);
			const serviceB = await finalContainer.resolve(ServiceB);
			const serviceC = await finalContainer.resolve(ServiceC);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceC).toBeInstanceOf(ServiceC);
		});

		it('should merge two layers with Layer.merge', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const mergedLayer = Layer.merge(layerA, layerB);

			const container = Container.empty();
			const finalContainer = mergedLayer.register(container);

			const serviceA = await finalContainer.resolve(ServiceA);
			const serviceB = await finalContainer.resolve(ServiceB);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
		});
	});

	describe('layer with finalizers', () => {
		it('should handle finalizers in layers', async () => {
			class ServiceWithCleanup extends Tag.Service('ServiceWithCleanup') {
				cleanup = vi.fn() as () => void;
			}

			const layerWithFinalizer = layer<never, typeof ServiceWithCleanup>(
				(container) =>
					container.register(ServiceWithCleanup, {
						factory: () => new ServiceWithCleanup(),
						finalizer: (instance) => {
							instance.cleanup();
						},
					})
			);

			const container = Container.empty();
			const finalContainer = layerWithFinalizer.register(container);

			const service = await finalContainer.resolve(ServiceWithCleanup);
			expect(service).toBeInstanceOf(ServiceWithCleanup);

			await finalContainer.destroy();

			expect(service.cleanup).toHaveBeenCalled();
		});

		it('should preserve finalizers through composition', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				cleanup = vi.fn();
			}

			class ServiceB extends Tag.Service('ServiceB') {
				cleanup = vi.fn();
			}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, {
					factory: () => new ServiceA(),
					finalizer: (instance) => {
						instance.cleanup();
					},
				})
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, {
					factory: () => new ServiceB(),
					finalizer: (instance) => {
						instance.cleanup();
					},
				})
			);

			const composedLayer = layerA.provideMerge(layerB);

			const container = Container.empty();
			const finalContainer = composedLayer.register(container);

			const serviceA = await finalContainer.resolve(ServiceA);
			const serviceB = await finalContainer.resolve(ServiceB);

			await finalContainer.destroy();

			expect(serviceA.cleanup).toHaveBeenCalled();
			expect(serviceB.cleanup).toHaveBeenCalled();
		});
	});

	describe('layers with value tags', () => {
		it('should work with value tags', async () => {
			const DatabaseUrlTag = Tag.of('databaseUrl')<string>();
			const ApiKeyTag = Tag.of('apiKey')<string>();

			const configLayer = layer<
				never,
				typeof DatabaseUrlTag | typeof ApiKeyTag
			>((container) =>
				container
					.register(
						DatabaseUrlTag,
						() => 'postgresql://localhost:5432'
					)
					.register(ApiKeyTag, () => 'secret-key')
			);

			const container = Container.empty();
			const finalContainer = configLayer.register(container);

			const dbUrl = await finalContainer.resolve(DatabaseUrlTag);
			const apiKey = await finalContainer.resolve(ApiKeyTag);

			expect(dbUrl).toBe('postgresql://localhost:5432');
			expect(apiKey).toBe('secret-key');
		});

		it('should mix value tags and service tags', async () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			class ApiService extends Tag.Service('ApiService') {
				constructor(private apiKey: string) {
					super();
				}

				getApiKey() {
					return this.apiKey;
				}
			}

			const configLayer = layer<never, typeof ApiKeyTag>((container) =>
				container.register(ApiKeyTag, () => 'secret-key')
			);

			const serviceLayer = layer<typeof ApiKeyTag, typeof ApiService>(
				(container) =>
					container.register(
						ApiService,
						async (ctx) =>
							new ApiService(await ctx.resolve(ApiKeyTag))
					)
			);

			const appLayer = serviceLayer.provide(configLayer);

			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			const apiService = await finalContainer.resolve(ApiService);
			expect(apiService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error scenarios', () => {
		it('should propagate container errors through layers', async () => {
			class FailingService extends Tag.Service('FailingService') {}

			const failingLayer = layer<never, typeof FailingService>(
				(container) =>
					container.register(FailingService, () => {
						throw new Error('Factory failed');
					})
			);

			const container = Container.empty();
			const finalContainer = failingLayer.register(container);

			await expect(
				finalContainer.resolve(FailingService)
			).rejects.toThrow();
		});

		it('should handle circular dependencies across layers', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				constructor(private _serviceB: ServiceB) {
					super();
				}
			}

			class ServiceB extends Tag.Service('ServiceB') {
				constructor(private _serviceA: ServiceA) {
					super();
				}
			}

			const layerA = layer<typeof ServiceB, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) => new ServiceA(await ctx.resolve(ServiceB))
					)
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
					)
			);

			const circularLayer = layerA.merge(layerB);

			const container = Container.empty();
			// @ts-expect-error - circular dependency
			const finalContainer = circularLayer.register(container);

			await expect(finalContainer.resolve(ServiceA)).rejects.toThrow();
		});
	});

	describe('real-world scenarios', () => {
		it('should handle a complete application layer stack', async () => {
			// Configuration layer
			const ConfigTag = Tag.of('config')<{
				dbUrl: string;
				redisUrl: string;
				apiKey: string;
			}>();

			const configLayer = layer<never, typeof ConfigTag>((container) =>
				container.register(ConfigTag, () => ({
					dbUrl: 'postgresql://localhost:5432',
					redisUrl: 'redis://localhost:6379',
					apiKey: 'app-secret',
				}))
			);

			// Infrastructure layer
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private dbUrl: string) {
					super();
				}

				query() {
					return `Querying ${this.dbUrl}`;
				}
			}

			class CacheService extends Tag.Service('CacheService') {
				constructor(private redisUrl: string) {
					super();
				}

				get() {
					return `Caching with ${this.redisUrl}`;
				}
			}

			const infraLayer = layer<
				typeof ConfigTag,
				typeof DatabaseService | typeof CacheService
			>((container) =>
				container
					.register(DatabaseService, async (ctx) => {
						const config = await ctx.resolve(ConfigTag);
						return new DatabaseService(config.dbUrl);
					})
					.register(CacheService, async (ctx) => {
						const config = await ctx.resolve(ConfigTag);
						return new CacheService(config.redisUrl);
					})
			);

			// Service layer
			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private cache: CacheService,
					private apiKey: string
				) {
					super();
				}

				getUser() {
					return `${this.db.query()} + ${this.cache.get()} + ${this.apiKey}`;
				}
			}

			const serviceLayer = layer<
				typeof DatabaseService | typeof CacheService | typeof ConfigTag,
				typeof UserService
			>((container) =>
				container.register(UserService, async (ctx) => {
					const [db, cache, config] = await Promise.all([
						ctx.resolve(DatabaseService),
						ctx.resolve(CacheService),
						ctx.resolve(ConfigTag),
					]);
					return new UserService(db, cache, config.apiKey);
				})
			);

			// Application layer
			const appLayer = serviceLayer
				.provide(infraLayer)
				.provide(configLayer);

			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			const userService = await finalContainer.resolve(UserService);
			expect(userService.getUser()).toBe(
				'Querying postgresql://localhost:5432 + Caching with redis://localhost:6379 + app-secret'
			);
		});
	});
});
