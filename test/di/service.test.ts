import { describe, expect, it } from 'vitest';
import { container } from '../../src/di/container.js';
import { service } from '../../src/di/service.js';
import { Tag } from '../../src/di/tag.js';

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
			const userService = service(UserService, async (container) => {
				const db = await container.get(DatabaseService);
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
			const dbService = service<typeof DatabaseService>(
				DatabaseService,
				async (container) => {
					return new DatabaseService(
						await container.get(ConfigService)
					);
				}
			);

			// Compose servicest
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

	describe('Service interface', () => {
		it('should expose the serviceClass property', () => {
			class TestService extends Tag.Class('TestService') {}

			const testService = service(TestService, () => new TestService());

			expect(testService.serviceClass).toBe(TestService);
		});
	});
});
