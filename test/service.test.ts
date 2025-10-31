import { Container } from '@/container.js';
import { service } from '@/service.js';
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
			const c = Container.empty();
			const finalContainer = loggerService.register(c);

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
			const c = Container.empty();
			const finalContainer = appLayer.register(c);

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

			const c = Container.empty();
			const finalContainer = infraLayer.register(c);

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

			const c = Container.empty();
			const finalContainer = utilsLayer.register(c);

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

			const c = Container.empty();
			const finalContainer = dbService.register(c);

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

			const c = Container.empty();
			const finalContainer = resourceService.register(c);

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

			const c = Container.empty();
			const finalContainer = appLayer.register(c);

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
});
