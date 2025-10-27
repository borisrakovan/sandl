import { container } from '@/container.js';
import { layer, Layer } from '@/layer.js';
import { Tag } from '@/tag.js';
import { value } from '@/value.js';

// Real-world services with proper dependencies

// Database layer - provides database connection
export class DatabaseConnection extends Tag.Class('DatabaseConnection') {
	constructor(private connectionString: string) {
		super();
	}

	async query(sql: string): Promise<unknown[]> {
		console.log(`Executing: ${sql} on ${this.connectionString}`);
		return Promise.resolve([{ id: 1, name: 'test' }]);
	}
}

// Cache layer - provides Redis client
export class CacheService extends Tag.Class('CacheService') {
	constructor(
		private redisUrl: string,
		private redisPassword: string
	) {
		super();
	}

	async get(key: string): Promise<string | null> {
		console.log(`Cache GET: ${key} from ${this.redisUrl}`);
		return Promise.resolve(null);
	}

	async set(key: string, value: string): Promise<void> {
		console.log(`Cache SET: ${key}=${value} to ${this.redisUrl}`);
		return Promise.resolve();
	}
}

// User repository - requires database connection
export class UserRepository extends Tag.Class('UserRepository') {
	constructor(private db: DatabaseConnection) {
		super();
	}

	async findById(id: number) {
		return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
	}

	async create(userData: { name: string; email: string }) {
		return this.db.query(
			`INSERT INTO users (name, email) VALUES ('${userData.name}', '${userData.email}')`
		);
	}
}

// User service - requires both user repo and cache
export class UserService extends Tag.Class('UserService') {
	constructor(
		private userRepo: UserRepository,
		private cache: CacheService
	) {
		super();
	}

	async getUser(id: number) {
		const cacheKey = `user:${id}`;
		const cached = await this.cache.get(cacheKey);

		if (cached !== null) {
			return Promise.resolve(
				JSON.parse(cached) as { id: number; name: string }
			);
		}

		const user = await this.userRepo.findById(id);
		await this.cache.set(cacheKey, JSON.stringify(user));
		return user;
	}

	async createUser(userData: { name: string; email: string }) {
		const user = await this.userRepo.create(userData);
		// Invalidate cache or update it
		return user;
	}
}

// Email service - independent, no dependencies
export class EmailService extends Tag.Class('EmailService') {
	constructor(private apiKey: string) {
		super();
	}

	async sendEmail(to: string, subject: string, _body: string) {
		console.log(
			`Sending email to ${to}: ${subject} (using key: ${this.apiKey})`
		);
		return Promise.resolve({ messageId: 'msg-123' });
	}
}

// Notification service - requires email service
export class NotificationService extends Tag.Class('NotificationService') {
	constructor(private emailService: EmailService) {
		super();
	}

	async notifyUserCreated(email: string, name: string) {
		return this.emailService.sendEmail(
			email,
			'Welcome!',
			`Hello ${name}, welcome to our platform!`
		);
	}
}

// Application service - requires user service and notification service
export class AppService extends Tag.Class('AppService') {
	constructor(
		private userService: UserService,
		private notificationService: NotificationService
	) {
		super();
	}

	async registerUser(userData: { name: string; email: string }) {
		const user = await this.userService.createUser(userData);
		await this.notificationService.notifyUserCreated(
			userData.email,
			userData.name
		);
		return user;
	}

	async getUser(id: number) {
		return this.userService.getUser(id);
	}
}

// Configuration value tags
const ConnectionString = Tag.of('ConnectionString')<string>();
const ApiKey = Tag.of('ApiKey')<string>();
const RedisConfig = Tag.of('RedisConfig')<{ url: string; password: string }>();

// Infrastructure layers (no dependencies)
const databaseLayer = layer<typeof ConnectionString, typeof DatabaseConnection>(
	(container) =>
		container.register(
			DatabaseConnection,
			async () =>
				new DatabaseConnection(await container.get(ConnectionString))
		)
);

const cacheLayer = layer<typeof RedisConfig, typeof CacheService>((container) =>
	container.register(CacheService, async () => {
		const config = await container.get(RedisConfig);
		return new CacheService(config.url, config.password);
	})
);

const emailLayer = layer<typeof ApiKey, typeof EmailService>((container) =>
	container.register(
		EmailService,
		async () => new EmailService(await container.get(ApiKey))
	)
);

// Repository layer (requires database)
const userRepositoryLayer = layer<
	typeof DatabaseConnection,
	typeof UserRepository
>((container) =>
	container.register(
		UserRepository,
		async () => new UserRepository(await container.get(DatabaseConnection))
	)
);

// Service layers (require repositories and infrastructure)
const userServiceLayer = layer<
	typeof UserRepository | typeof CacheService,
	typeof UserService
>((container) =>
	container.register(
		UserService,
		async () =>
			new UserService(
				await container.get(UserRepository),
				await container.get(CacheService)
			)
	)
);

const notificationServiceLayer = layer<
	typeof EmailService,
	typeof NotificationService
>((container) =>
	container.register(
		NotificationService,
		async () => new NotificationService(await container.get(EmailService))
	)
);

// Application layer (requires all business services)
const appServiceLayer = layer<
	typeof UserService | typeof NotificationService,
	typeof AppService
>((container) =>
	container.register(
		AppService,
		async (ctx) =>
			new AppService(
				await ctx.get(UserService),
				await ctx.get(NotificationService)
			)
	)
);

// Demonstration of layer composition

// Build infrastructure layers
const infrastructure = Layer.mergeAll(databaseLayer, cacheLayer, emailLayer);

// Add repository layer that depends on database
const withRepositories = userRepositoryLayer.provideMerge(infrastructure);

// Add service layers that depend on repositories and infrastructure
const businessServices = Layer.mergeAll(
	userServiceLayer,
	notificationServiceLayer
);

const withServices = businessServices.provideMerge(withRepositories);

// Finally add application layer
const completeApplication = appServiceLayer.provideMerge(withServices);

// Alternative: Build the entire application in one go using merge
const _completeApplicationOneGo = appServiceLayer
	.provideMerge(Layer.mergeAll(userServiceLayer, notificationServiceLayer))
	.provideMerge(userRepositoryLayer)
	.provideMerge(Layer.mergeAll(databaseLayer, cacheLayer, emailLayer));

const config = Layer.mergeAll(
	value(ConnectionString, 'sqlite://memory'),
	value(RedisConfig, { url: 'redis://localhost', password: 'password' }),
	value(ApiKey, 'api-key')
);

// Usage example with step-by-step composition
export async function demonstrateLayerUsage() {
	const appContainer = container();

	const appWithConfig = completeApplication.provideMerge(config);

	const finalContainer = appWithConfig.register(appContainer);

	// Now we can use the fully configured application
	const app = await finalContainer.get(AppService);

	// Register a new user - this will:
	// 1. Use UserService to create user (via UserRepository -> DatabaseConnection)
	// 2. Use NotificationService to send welcome email (via EmailService)
	const user = await app.registerUser({
		name: 'John Doe',
		email: 'john@example.com',
	});

	console.log('User registered:', user);

	// Get user - this will:
	// 1. Check cache first (CacheService)
	// 2. If not found, query database (UserRepository -> DatabaseConnection)
	// 3. Cache the result
	const fetchedUser = await app.getUser(1);
	console.log('Fetched user:', fetchedUser);

	const connectionString = await finalContainer.get(ConnectionString);
	console.log('Connection string:', connectionString);

	// Clean up
	await finalContainer.destroy();
}

// Example with many infrastructure layers
export const bigInfrastructureLayer = Layer.mergeAll(
	databaseLayer,
	cacheLayer,
	emailLayer,
	// Could add more...
	layer<typeof ConnectionString, typeof DatabaseConnection>((container) =>
		container.register(
			DatabaseConnection,
			async () =>
				new DatabaseConnection(await container.get(ConnectionString))
		)
	),
	layer<typeof RedisConfig, typeof CacheService>((container) =>
		container.register(CacheService, async () => {
			const config = await container.get(RedisConfig);
			return new CacheService(config.url, config.password);
		})
	)
);

// Type test - the complete application should require nothing external (never)
// and provide all the services we defined
export async function testCompleteApplication() {
	const appContainer = container()
		.register(ConnectionString, () => 'sqlite://memory')
		.register(RedisConfig, () => ({
			url: 'redis://localhost',
			password: 'password',
		}))
		.register(ApiKey, () => 'api-key');

	// This should work - completeApplication requires `never` (no external dependencies)
	const finalContainer = config
		.provideMerge(completeApplication)
		.register(appContainer);

	// Should be able to get all our services
	const app = await finalContainer.get(AppService);
	const db = await finalContainer.get(DatabaseConnection);
	const cache = await finalContainer.get(CacheService);
	const email = await finalContainer.get(EmailService);
	const userRepo = await finalContainer.get(UserRepository);
	const userService = await finalContainer.get(UserService);
	const notification = await finalContainer.get(NotificationService);

	// Complete application works with manual container creation

	console.log('All services available:', {
		app,
		db,
		cache,
		email,
		userRepo,
		userService,
		notification,
	});

	await finalContainer.destroy();
}

void testCompleteApplication();
