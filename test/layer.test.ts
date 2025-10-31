import { Container } from '@/container.js';
import { layer, Layer } from '@/layer.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('Layer', () => {
	describe('layer factory', () => {
		it('should create a simple layer without parameters', () => {
			class TestService extends Tag.Class('TestService') {
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
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'test';
				}
			}

			const testLayer = layer<never, typeof TestService>((container) =>
				container.register(TestService, () => new TestService())
			);

			const c = Container.empty();
			const updatedContainer = testLayer.register(c);

			const instance = await updatedContainer.get(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});
	});

	describe('layer composition with "provide"', () => {
		it('should compose layers where source provides dependencies to target', async () => {
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
							new UserService(await ctx.get(DatabaseService))
					)
			);

			const composedLayer = userLayer.provide(databaseLayer);

			const c = Container.empty();
			const finalContainer = composedLayer.register(c);

			const userService = await finalContainer.get(UserService);
			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle multi-level composition', async () => {
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

			class UserService extends Tag.Class('UserService') {
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
						new DatabaseService(await ctx.get(ConfigService))
				)
			);

			const userLayer = layer<typeof DatabaseService, typeof UserService>(
				(container) =>
					container.register(
						UserService,
						async (ctx) =>
							new UserService(await ctx.get(DatabaseService))
					)
			);

			const finalLayer = userLayer
				.provide(databaseLayer)
				.provide(configLayer);

			const c = Container.empty();
			const finalContainer = finalLayer.register(c);

			const userService = await finalContainer.get(UserService);
			expect(userService.getUser()).toBe('Connected to db://localhost');
		});

		it('should handle external dependencies in composition', async () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			class DatabaseService extends Tag.Class('DatabaseService') {}

			class UserService extends Tag.Class('UserService') {
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
							await ctx.get(ApiKeyTag),
							await ctx.get(DatabaseService)
						)
				)
			);

			const composedLayer = userLayer.provide(databaseLayer);

			// Pre-register the API key dependency
			const c = Container.empty().register(ApiKeyTag, () => 'secret-key');
			const finalContainer = composedLayer.register(c);

			const userService = await finalContainer.get(UserService);
			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('layer composition with "provideMerge"', () => {
		it("should compose layers and expose both layers' provisions", async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getConfig() {
					return 'config-value';
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
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
						new DatabaseService(await ctx.get(ConfigService))
				)
			);

			const infraLayer = databaseLayer.provideMerge(configLayer);

			const c = Container.empty();
			const finalContainer = infraLayer.register(c);

			// Both services should be available
			const config = await finalContainer.get(ConfigService);
			const database = await finalContainer.get(DatabaseService);

			expect(config.getConfig()).toBe('config-value');
			expect(database.connect()).toBe('Connected with config-value');
		});

		it('should differ from .provide() by exposing source layer provisions', async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getValue() {
					return 'config';
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
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
						new DatabaseService(await ctx.get(ConfigService))
				)
			);

			// .provide() only exposes target layer's provisions
			const withProvide = databaseLayer.provide(configLayer);
			const provideContainer = withProvide.register(Container.empty());

			// Should have DatabaseService but not ConfigService directly accessible
			const db1 = await provideContainer.get(DatabaseService);
			expect(db1.getValue()).toBe('db-config');

			// .provideMerge() exposes both layers' provisions
			const withProvideMerge = databaseLayer.provideMerge(configLayer);
			const provideMergeContainer = withProvideMerge.register(
				Container.empty()
			);

			// Should have both services accessible
			const config = await provideMergeContainer.get(ConfigService);
			const db2 = await provideMergeContainer.get(DatabaseService);

			expect(config.getValue()).toBe('config');
			expect(db2.getValue()).toBe('db-config');
		});
	});

	describe('layer merging with "merge"', () => {
		it('should merge two independent layers', async () => {
			class ServiceA extends Tag.Class('ServiceA') {
				getValue() {
					return 'A';
				}
			}

			class ServiceB extends Tag.Class('ServiceB') {
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

			const c = Container.empty();
			const finalContainer = mergedLayer.register(c);

			const serviceA = await finalContainer.get(ServiceA);
			const serviceB = await finalContainer.get(ServiceB);

			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should merge layers with shared dependencies', async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getConfig() {
					return 'config';
				}
			}

			class ServiceA extends Tag.Class('ServiceA') {
				constructor(private config: ConfigService) {
					super();
				}

				getValue() {
					return `A-${this.config.getConfig()}`;
				}
			}

			class ServiceB extends Tag.Class('ServiceB') {
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
							new ServiceA(await ctx.get(ConfigService))
					)
			);

			const serviceLayerB = layer<typeof ConfigService, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) =>
							new ServiceB(await ctx.get(ConfigService))
					)
			);

			// First register config, then merge the service layers
			const baseLayer = configLayer;
			const mergedServices = serviceLayerA.merge(serviceLayerB);
			const finalLayer = mergedServices.provide(baseLayer);

			const c = Container.empty();
			const finalContainer = finalLayer.register(c);

			const serviceA = await finalContainer.get(ServiceA);
			const serviceB = await finalContainer.get(ServiceB);

			expect(serviceA.getValue()).toBe('A-config');
			expect(serviceB.getValue()).toBe('B-config');
		});

		it('should handle complex merging scenarios', async () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class CacheService extends Tag.Class('CacheService') {}
			class EmailService extends Tag.Class('EmailService') {}
			class LoggingService extends Tag.Class('LoggingService') {}

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

			const c = Container.empty();
			const finalContainer = infraLayer.register(c);

			const db = await finalContainer.get(DatabaseService);
			const cache = await finalContainer.get(CacheService);
			const email = await finalContainer.get(EmailService);
			const logging = await finalContainer.get(LoggingService);

			expect(db).toBeInstanceOf(DatabaseService);
			expect(cache).toBeInstanceOf(CacheService);
			expect(email).toBeInstanceOf(EmailService);
			expect(logging).toBeInstanceOf(LoggingService);
		});
	});

	describe('Layer utilities', () => {
		it('should create empty layer', () => {
			const emptyLayer = Layer.empty();

			const c = Container.empty();
			const result = emptyLayer.register(c);

			expect(result).toBe(c); // Should be the same container
		});

		it('should merge multiple layers with Layer.mergeAll', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}

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

			const c = Container.empty();
			const finalContainer = mergedLayer.register(c);

			const serviceA = await finalContainer.get(ServiceA);
			const serviceB = await finalContainer.get(ServiceB);
			const serviceC = await finalContainer.get(ServiceC);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceC).toBeInstanceOf(ServiceC);
		});

		it('should merge two layers with Layer.merge', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const mergedLayer = Layer.merge(layerA, layerB);

			const c = Container.empty();
			const finalContainer = mergedLayer.register(c);

			const serviceA = await finalContainer.get(ServiceA);
			const serviceB = await finalContainer.get(ServiceB);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
		});
	});

	describe('layer with finalizers', () => {
		it('should handle finalizers in layers', async () => {
			class ServiceWithCleanup extends Tag.Class('ServiceWithCleanup') {
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

			const c = Container.empty();
			const finalContainer = layerWithFinalizer.register(c);

			const service = await finalContainer.get(ServiceWithCleanup);
			expect(service).toBeInstanceOf(ServiceWithCleanup);

			await finalContainer.destroy();

			expect(service.cleanup).toHaveBeenCalled();
		});

		it('should preserve finalizers through composition', async () => {
			class ServiceA extends Tag.Class('ServiceA') {
				cleanup = vi.fn();
			}

			class ServiceB extends Tag.Class('ServiceB') {
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

			const c = Container.empty();
			const finalContainer = composedLayer.register(c);

			const serviceA = await finalContainer.get(ServiceA);
			const serviceB = await finalContainer.get(ServiceB);

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

			const c = Container.empty();
			const finalContainer = configLayer.register(c);

			const dbUrl = await finalContainer.get(DatabaseUrlTag);
			const apiKey = await finalContainer.get(ApiKeyTag);

			expect(dbUrl).toBe('postgresql://localhost:5432');
			expect(apiKey).toBe('secret-key');
		});

		it('should mix value tags and service tags', async () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			class ApiService extends Tag.Class('ApiService') {
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
						async (ctx) => new ApiService(await ctx.get(ApiKeyTag))
					)
			);

			const appLayer = serviceLayer.provide(configLayer);

			const c = Container.empty();
			const finalContainer = appLayer.register(c);

			const apiService = await finalContainer.get(ApiService);
			expect(apiService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error scenarios', () => {
		it('should propagate container errors through layers', async () => {
			class FailingService extends Tag.Class('FailingService') {}

			const failingLayer = layer<never, typeof FailingService>(
				(container) =>
					container.register(FailingService, () => {
						throw new Error('Factory failed');
					})
			);

			const c = Container.empty();
			const finalContainer = failingLayer.register(c);

			await expect(finalContainer.get(FailingService)).rejects.toThrow();
		});

		it('should handle circular dependencies across layers', async () => {
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

			const layerA = layer<typeof ServiceB, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (ctx) => new ServiceA(await ctx.get(ServiceB))
					)
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (ctx) => new ServiceB(await ctx.get(ServiceA))
					)
			);

			const circularLayer = layerA.merge(layerB);

			const c = Container.empty();
			// @ts-expect-error - circular dependency
			const finalContainer = circularLayer.register(c);

			await expect(finalContainer.get(ServiceA)).rejects.toThrow();
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
			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private dbUrl: string) {
					super();
				}

				query() {
					return `Querying ${this.dbUrl}`;
				}
			}

			class CacheService extends Tag.Class('CacheService') {
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
						const config = await ctx.get(ConfigTag);
						return new DatabaseService(config.dbUrl);
					})
					.register(CacheService, async (ctx) => {
						const config = await ctx.get(ConfigTag);
						return new CacheService(config.redisUrl);
					})
			);

			// Service layer
			class UserService extends Tag.Class('UserService') {
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
						ctx.get(DatabaseService),
						ctx.get(CacheService),
						ctx.get(ConfigTag),
					]);
					return new UserService(db, cache, config.apiKey);
				})
			);

			// Application layer
			const appLayer = serviceLayer
				.provide(infraLayer)
				.provide(configLayer);

			const c = Container.empty();
			const finalContainer = appLayer.register(c);

			const userService = await finalContainer.get(UserService);
			expect(userService.getUser()).toBe(
				'Querying postgresql://localhost:5432 + Caching with redis://localhost:6379 + app-secret'
			);
		});
	});
});
