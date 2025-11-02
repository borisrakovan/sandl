import { Container } from '@/container.js';
import { autoService, service } from '@/service.js';
import { Tag } from '@/tag.js';
import { describe, expect, it } from 'vitest';

describe('Service', () => {
	describe('Basic service creation', () => {
		it('should create a service layer for a simple class', async () => {
			class LoggerService extends Tag.Service('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);

			// Apply the service to a container
			const container = Container.empty();
			const finalContainer = loggerService.register(container);

			// Get the service instance
			const logger = await finalContainer.resolve(LoggerService);
			expect(logger.log('test')).toBe('Logged: test');
		});
	});

	describe('Service with dependencies', () => {
		it('should create a service layer that requires dependencies', async () => {
			// Define services
			class DatabaseService extends Tag.Service('DatabaseService') {
				query(sql: string) {
					return [`Result for: ${sql}`];
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUsers() {
					return this.db.query('SELECT * FROM users');
				}
			}

			// Create service layers
			const dbService = service(
				DatabaseService,
				() => new DatabaseService()
			);
			const userService = service(UserService, async (ctx) => {
				const db = await ctx.resolve(DatabaseService);
				return new UserService(db);
			});

			// Compose layers
			const appLayer = userService.provide(dbService);

			// Apply to container
			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			// Test the composed services
			const users = await finalContainer.resolve(UserService);
			expect(users.getUsers()).toEqual([
				'Result for: SELECT * FROM users',
			]);
		});
	});

	describe('Service composition', () => {
		it('should allow composing services with .provide()', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getConfig() {
					return { dbUrl: 'postgresql://localhost:5432' };
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getConfig().dbUrl}`;
				}
			}

			const configService = service(
				ConfigService,
				() => new ConfigService()
			);
			const dbService = service(DatabaseService, async (ctx) => {
				return new DatabaseService(await ctx.resolve(ConfigService));
			});

			// Compose services
			const infraLayer = dbService.provide(configService);

			const container = Container.empty();
			const finalContainer = infraLayer.register(container);

			const db = await finalContainer.resolve(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});

		it('should allow merging services with .merge()', async () => {
			class LoggerService extends Tag.Service('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			class CacheService extends Tag.Service('CacheService') {
				get(key: string) {
					return `Cached value for: ${key}`;
				}
			}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);
			const cacheService = service(
				CacheService,
				() => new CacheService()
			);

			// Merge independent services
			const utilsLayer = loggerService.merge(cacheService);

			const container = Container.empty();
			const finalContainer = utilsLayer.register(container);

			const logger = await finalContainer.resolve(LoggerService);
			const cache = await finalContainer.resolve(CacheService);

			expect(logger.log('test')).toBe('Logged: test');
			expect(cache.get('key')).toBe('Cached value for: key');
		});
	});

	describe('Service with finalizers', () => {
		it('should create a service layer with a finalizer using DependencyLifecycle', async () => {
			const cleanupCalls: string[] = [];

			class DatabaseConnection extends Tag.Service('DatabaseConnection') {
				constructor(private url: string) {
					super();
				}

				connect() {
					return `Connected to ${this.url}`;
				}

				disconnect() {
					cleanupCalls.push('DatabaseConnection.disconnect');
				}
			}

			// Use DependencyLifecycle object with factory and finalizer
			const dbService = service(DatabaseConnection, {
				factory: () =>
					new DatabaseConnection('postgresql://localhost:5432'),
				finalizer: (conn) => {
					conn.disconnect();
				},
			});

			const container = Container.empty();
			const finalContainer = dbService.register(container);

			// Use the service
			const db = await finalContainer.resolve(DatabaseConnection);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);

			// Destroy the container to trigger finalizers
			await finalContainer.destroy();

			// Verify finalizer was called
			expect(cleanupCalls).toEqual(['DatabaseConnection.disconnect']);
		});

		it('should work with async finalizers', async () => {
			const cleanupCalls: string[] = [];

			class AsyncResource extends Tag.Service('AsyncResource') {
				initialize() {
					return 'initialized';
				}

				async cleanup() {
					cleanupCalls.push('AsyncResource.cleanup');
					await new Promise((resolve) => setTimeout(resolve, 1)); // Simulate async cleanup
				}
			}

			const resourceService = service(AsyncResource, {
				factory: () => {
					const resource = new AsyncResource();
					resource.initialize();
					return resource;
				},
				finalizer: async (resource) => {
					await resource.cleanup();
				},
			});

			const container = Container.empty();
			const finalContainer = resourceService.register(container);

			// Use the service
			const resource = await finalContainer.resolve(AsyncResource);
			expect(resource.initialize()).toBe('initialized');

			// Destroy the container to trigger finalizers
			await finalContainer.destroy();

			// Verify async finalizer was called
			expect(cleanupCalls).toEqual(['AsyncResource.cleanup']);
		});

		it('should support finalizers with service dependencies', async () => {
			const cleanupCalls: string[] = [];

			class Logger extends Tag.Service('Logger') {
				log(message: string) {
					cleanupCalls.push(`Logger: ${message}`);
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private logger: Logger) {
					super();
				}

				query(sql: string) {
					this.logger.log(`Executing: ${sql}`);
					return [`Result for: ${sql}`];
				}

				close() {
					this.logger.log('Database connection closed');
				}
			}

			const loggerService = service(Logger, () => new Logger());

			const dbService = service(DatabaseService, {
				factory: async (ctx) => {
					const logger = await ctx.resolve(Logger);
					return new DatabaseService(logger);
				},
				finalizer: (db) => {
					db.close();
				},
			});

			// Compose services
			const appLayer = dbService.provide(loggerService);

			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			// Use the services
			const db = await finalContainer.resolve(DatabaseService);
			db.query('SELECT * FROM users');

			// Destroy the container
			await finalContainer.destroy();

			expect(cleanupCalls).toEqual([
				'Logger: Executing: SELECT * FROM users',
				'Logger: Database connection closed',
			]);
		});
	});

	describe('AutoService', () => {
		it('should automatically inject dependencies based on constructor parameters', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private url: string) {
					super();
				}
				connect() {
					return `Connected to ${this.url}`;
				}
				query(sql: string) {
					return [`Result for: ${sql}`];
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private timeout: number
				) {
					super();
				}
				getUsers() {
					return this.db.query('SELECT * FROM users');
				}
				getTimeout() {
					return this.timeout;
				}
			}

			// Create service layers using autoService
			const dbService = autoService(DatabaseService, [
				'postgresql://localhost:5432',
			]);
			const userService = autoService(UserService, [
				DatabaseService,
				5000,
			]);

			// Compose layers
			const appLayer = userService.provide(dbService);

			// Apply to container
			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			// Test the services
			const users = await finalContainer.resolve(UserService);
			expect(users.getUsers()).toEqual([
				'Result for: SELECT * FROM users',
			]);
			expect(users.getTimeout()).toBe(5000);
		});

		it('should handle mixed dependencies and static values', async () => {
			class LoggerService extends Tag.Service('LoggerService') {
				log(message: string) {
					return `[LOG] ${message}`;
				}
			}

			class CacheService extends Tag.Service('CacheService') {
				get(key: string) {
					return `cached-${key}`;
				}
			}

			class NotificationService extends Tag.Service(
				'NotificationService'
			) {
				constructor(
					private logger: LoggerService,
					private apiKey: string,
					private retries: number,
					private cache: CacheService
				) {
					super();
				}

				notify(message: string) {
					this.logger.log(`Notification: ${message}`);
					const cached = this.cache.get('notification');
					return `${cached} with key ${this.apiKey} (retries: ${this.retries})`;
				}
			}

			// Create service layers with mixed parameters
			const loggerService = autoService(LoggerService, []);
			const cacheService = autoService(CacheService, []);
			const notificationService = autoService(NotificationService, [
				LoggerService, // DI dependency
				'secret-key', // Static string
				3, // Static number
				CacheService, // DI dependency
			]);

			// Compose layers
			const appLayer = notificationService.provide(
				loggerService.merge(cacheService)
			);

			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			const notifications =
				await finalContainer.resolve(NotificationService);
			const result = notifications.notify('test message');
			expect(result).toBe(
				'cached-notification with key secret-key (retries: 3)'
			);
		});

		it('should work with services that have no constructor parameters', async () => {
			class SimpleService extends Tag.Service('SimpleService') {
				getValue() {
					return 'simple';
				}
			}

			const simpleService = autoService(SimpleService, []);

			const container = Container.empty();
			const finalContainer = simpleService.register(container);

			const service = await finalContainer.resolve(SimpleService);
			expect(service.getValue()).toBe('simple');
		});

		it('should work with only static parameters', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				constructor(
					private host: string,
					private port: number,
					private ssl: boolean
				) {
					super();
				}

				getConnectionString() {
					const protocol = this.ssl ? 'https' : 'http';
					return `${protocol}://${this.host}:${this.port}`;
				}
			}

			const configService = autoService(ConfigService, [
				'localhost',
				8080,
				true,
			]);

			const container = Container.empty();
			const finalContainer = configService.register(container);

			const config = await finalContainer.resolve(ConfigService);
			expect(config.getConnectionString()).toBe('https://localhost:8080');
		});

		it('should maintain correct parameter order with complex mixed dependencies', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private name: string) {
					super();
				}
				getName() {
					return this.name;
				}
			}

			class CacheService extends Tag.Service('CacheService') {
				constructor(private ttl: number) {
					super();
				}
				getTtl() {
					return this.ttl;
				}
			}

			class ComplexService extends Tag.Service('ComplexService') {
				constructor(
					private prefix: string,
					private db: DatabaseService,
					private maxRetries: number,
					private cache: CacheService,
					private suffix: string
				) {
					super();
				}

				getInfo() {
					return {
						prefix: this.prefix,
						dbName: this.db.getName(),
						maxRetries: this.maxRetries,
						cacheTtl: this.cache.getTtl(),
						suffix: this.suffix,
					};
				}
			}

			// Create service layers
			const dbService = autoService(DatabaseService, ['maindb']);
			const cacheService = autoService(CacheService, [300]);
			const complexService = autoService(ComplexService, [
				'pre-', // Static string
				DatabaseService, // DI dependency
				5, // Static number
				CacheService, // DI dependency
				'-post', // Static string
			]);

			// Compose layers
			const appLayer = complexService.provide(
				dbService.merge(cacheService)
			);

			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			const complex = await finalContainer.resolve(ComplexService);
			expect(complex.getInfo()).toEqual({
				prefix: 'pre-',
				dbName: 'maindb',
				maxRetries: 5,
				cacheTtl: 300,
				suffix: '-post',
			});
		});

		it('should support optional finalizers for cleanup', async () => {
			const cleanupCalls: string[] = [];

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private connectionString: string) {
					super();
				}

				async connect() {
					return Promise.resolve(
						`Connected to ${this.connectionString}`
					);
				}

				async disconnect() {
					cleanupCalls.push(
						`Disconnected from ${this.connectionString}`
					);
					return Promise.resolve();
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private timeout: number
				) {
					super();
				}

				getUsers() {
					return ['user1', 'user2'];
				}

				async cleanup() {
					cleanupCalls.push(
						`UserService cleanup with timeout ${this.timeout}`
					);
					return Promise.resolve();
				}
			}

			// Create services with finalizers
			const dbService = autoService(
				DatabaseService,
				['postgresql://localhost:5432'],
				(service) => service.disconnect()
			);

			const userService = autoService(
				UserService,
				[DatabaseService, 5000],
				(service) => service.cleanup()
			);

			// Compose layers
			const appLayer = userService.provideMerge(dbService);

			// Apply to container
			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			// Test the services work
			const users = await finalContainer.resolve(UserService);
			expect(users.getUsers()).toEqual(['user1', 'user2']);

			const db = await finalContainer.resolve(DatabaseService);
			expect(await db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);

			// Test finalizers are called during cleanup
			await finalContainer.destroy();

			expect(cleanupCalls).toContain(
				'Disconnected from postgresql://localhost:5432'
			);
			expect(cleanupCalls).toContain(
				'UserService cleanup with timeout 5000'
			);
		});

		it('should handle async finalizers correctly', async () => {
			const cleanupOrder: string[] = [];

			class AsyncService1 extends Tag.Service('AsyncService1') {
				constructor(
					private name: string,
					private delay: number
				) {
					super();
				}

				async cleanup() {
					await new Promise((resolve) =>
						setTimeout(resolve, this.delay)
					);
					cleanupOrder.push(this.name);
				}
			}

			class AsyncService2 extends Tag.Service('AsyncService2') {
				constructor(
					private name: string,
					private delay: number
				) {
					super();
				}

				async cleanup() {
					await new Promise((resolve) =>
						setTimeout(resolve, this.delay)
					);
					cleanupOrder.push(this.name);
				}
			}

			const service1 = autoService(
				AsyncService1,
				['service1', 10],
				(service) => service.cleanup()
			);

			const service2 = autoService(
				AsyncService2,
				['service2', 5],
				(service) => service.cleanup()
			);

			const appLayer = service1.merge(service2);
			const container = Container.empty();
			const finalContainer = appLayer.register(container);

			// Create instances
			await finalContainer.resolve(AsyncService1);
			await finalContainer.resolve(AsyncService2);

			// Cleanup should handle async finalizers
			const startTime = Date.now();
			await finalContainer.destroy();
			const endTime = Date.now();

			// Both finalizers should have been called
			expect(cleanupOrder).toHaveLength(2);
			expect(cleanupOrder).toContain('service1');
			expect(cleanupOrder).toContain('service2');

			// Should have run concurrently (not sequentially)
			// If sequential: 10ms + 5ms = 15ms minimum
			// If concurrent: max(10ms, 5ms) = 10ms + some overhead
			expect(endTime - startTime).toBeLessThan(15);
		});
	});
});
