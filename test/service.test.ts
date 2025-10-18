import { container } from '@/container.js';
import { service } from '@/service.js';
import { Tag } from '@/tag.js';
import { Inject } from '@/types.js';
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
			const appLayer = dbService.to(userService);

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
		it('should allow composing services with .to()', async () => {
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
			const infraLayer = configService.to(dbService);

			const c = container();
			const finalContainer = infraLayer.register(c);

			const db = await finalContainer.get(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});

		it('should allow merging services with .and()', async () => {
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
			const utilsLayer = loggerService.and(cacheService);

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
			const appLayer = dbUrlService.to(dbService);

			const c = container();
			const finalContainer = appLayer.register(c);

			const db = await finalContainer.get(DatabaseService);
			expect(db.connect()).toBe(
				'Connected to postgresql://localhost:5432'
			);
		});
	});
});
