import { container } from '@/container.js';
import { service } from '@/service.js';
import { Inject, Tag } from '@/tag.js';
import { describe, expect, it } from 'vitest';

describe('Service', () => {
	describe('Basic service creation', () => {
		it('should create a service layer for a simple class', async () => {
			class LoggerService extends Tag.Class('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			const loggerService = service(
				LoggerService,
				() => new LoggerService()
			);

			// Apply the service to a container
			const c = container();
			const finalContainer = loggerService.register(c);

			// Get the service instance
			const logger = await finalContainer.get(LoggerService);
			expect(logger.log('test')).toBe('Logged: test');
		});
	});

	describe('Service with dependencies', () => {
		it('should create a service layer that requires dependencies', async () => {
			// Define services
			class DatabaseService extends Tag.Class('DatabaseService') {
				query(sql: string) {
					return [`Result for: ${sql}`];
				}
			}

			class UserService extends Tag.Class('UserService') {
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
				const db = await ctx.get(DatabaseService);
				return new UserService(db);
			});

			// Compose layers
			const appLayer = userService.provide(dbService);

			// Apply to container
			const c = container();
			const finalContainer = appLayer.register(c);

			// Test the composed services
			const users = await finalContainer.get(UserService);
			expect(users.getUsers()).toEqual([
				'Result for: SELECT * FROM users',
			]);
		});
	});

	describe('Service composition', () => {
		it('should allow composing services with .provide()', async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getConfig() {
					return { dbUrl: 'postgresql://localhost:5432' };
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
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
				return new DatabaseService(await ctx.get(ConfigService));
			});

			// Compose services
			const infraLayer = dbService.provide(configService);

			const c = container();
			const finalContainer = infraLayer.register(c);

			const db = await finalContainer.get(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});

		it('should allow merging services with .merge()', async () => {
			class LoggerService extends Tag.Class('LoggerService') {
				log(message: string) {
					return `Logged: ${message}`;
				}
			}

			class CacheService extends Tag.Class('CacheService') {
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

			const c = container();
			const finalContainer = utilsLayer.register(c);

			const logger = await finalContainer.get(LoggerService);
			const cache = await finalContainer.get(CacheService);

			expect(logger.log('test')).toBe('Logged: test');
			expect(cache.get('key')).toBe('Cached value for: key');
		});
	});

	describe('ValueTag services', () => {
		it('should create a service layer for a ValueTag', async () => {
			const ApiKeyTag = Tag.of('apiKey')<string>();

			const apiKeyService = service(ApiKeyTag, () => 'test-api-key-123');

			// Apply the service to a container
			const c = container();
			const finalContainer = apiKeyService.register(c);

			// Get the service value
			const apiKey = await finalContainer.get(ApiKeyTag);
			expect(apiKey).toBe('test-api-key-123');
		});

		it('should compose ValueTag services with ClassTag services', async () => {
			const DatabaseUrlTag = Tag.of('dbUrl')<string>();

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private url: Inject<typeof DatabaseUrlTag>) {
					super();
				}

				connect() {
					return `Connected to ${this.url}`;
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

			// Compose the services
			const appLayer = dbService.provide(dbUrlService);

			const c = container();
			const finalContainer = appLayer.register(c);

			const db = await finalContainer.get(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});
	});

	describe('Service with finalizers', () => {
		it('should create a service layer with a finalizer using DependencyLifecycle', async () => {
			const cleanupCalls: string[] = [];

			class DatabaseConnection extends Tag.Class('DatabaseConnection') {
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
				finalizer: (conn) => conn.disconnect(),
			});

			const c = container();
			const finalContainer = dbService.register(c);

			// Use the service
			const db = await finalContainer.get(DatabaseConnection);
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

			class AsyncResource extends Tag.Class('AsyncResource') {
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

			const c = container();
			const finalContainer = resourceService.register(c);

			// Use the service
			const resource = await finalContainer.get(AsyncResource);
			expect(resource.initialize()).toBe('initialized');

			// Destroy the container to trigger finalizers
			await finalContainer.destroy();

			// Verify async finalizer was called
			expect(cleanupCalls).toEqual(['AsyncResource.cleanup']);
		});

		it('should support finalizers with service dependencies', async () => {
			const cleanupCalls: string[] = [];

			class Logger extends Tag.Class('Logger') {
				log(message: string) {
					cleanupCalls.push(`Logger: ${message}`);
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
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
					const logger = await ctx.get(Logger);
					return new DatabaseService(logger);
				},
				finalizer: (db) => {
					db.close();
				},
			});

			// Compose services
			const appLayer = dbService.provide(loggerService);

			const c = container();
			const finalContainer = appLayer.register(c);

			// Use the services
			const db = await finalContainer.get(DatabaseService);
			db.query('SELECT * FROM users');

			// Destroy the container
			await finalContainer.destroy();

			expect(cleanupCalls).toEqual([
				'Logger: Executing: SELECT * FROM users',
				'Logger: Database connection closed',
			]);
		});

		it('should support ValueTag services with finalizers', async () => {
			const cleanupCalls: string[] = [];

			const FileHandleTag = Tag.of('fileHandle')<{
				read: () => string;
				close: () => void;
			}>();

			const fileService = service(FileHandleTag, {
				factory: () => ({
					read: () => 'file content',
					close: () => cleanupCalls.push('File closed'),
				}),
				finalizer: (handle) => {
					handle.close();
				},
			});

			const c = container();
			const finalContainer = fileService.register(c);

			// Use the service
			const fileHandle = await finalContainer.get(FileHandleTag);
			expect(fileHandle.read()).toBe('file content');

			// Destroy the container
			await finalContainer.destroy();

			expect(cleanupCalls).toEqual(['File closed']);
		});
	});
});
