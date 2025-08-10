import { container } from '@/di/container.js';
import { Tag } from '@/di/tag.js';
import { layer, Layer } from '@/di/layer.js';

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
	constructor(private redisUrl: string) {
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

// Layer definitions

// Infrastructure layers (no dependencies)
const databaseLayer = layer<
	never,
	typeof DatabaseConnection,
	{ connectionString: string }
>((container, { connectionString }) =>
	container.register(
		DatabaseConnection,
		() => new DatabaseConnection(connectionString)
	)
);

const cacheLayer = layer<never, typeof CacheService, { redisUrl: string }>(
	(container, { redisUrl }) =>
		container.register(CacheService, () => new CacheService(redisUrl))
);

const emailLayer = layer<never, typeof EmailService, { apiKey: string }>(
	(container, { apiKey }) =>
		container.register(EmailService, () => new EmailService(apiKey))
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
		async () =>
			new AppService(
				await container.get(UserService),
				await container.get(NotificationService)
			)
	)
);

// Demonstration of improved layer composition

// 1. Build infrastructure layers - now using merge!
const infrastructure = Layer.merge(
	databaseLayer({ connectionString: 'postgresql://localhost:5432/myapp' }),
	cacheLayer({ redisUrl: 'redis://localhost:6379' }),
	emailLayer({ apiKey: 'email-api-key-123' })
);

// 2. Add repository layer that depends on database
const withRepositories = infrastructure.to(userRepositoryLayer());

// 3. Add service layers that depend on repositories and infrastructure
const businessServices = Layer.merge(
	userServiceLayer(),
	notificationServiceLayer()
);

const withServices = withRepositories.to(businessServices);

// 4. Finally add application layer
const completeApplication = withServices.to(appServiceLayer());

// Alternative: Build the entire application in one go using merge
const completeApplicationOneGo = Layer.merge(
	databaseLayer({ connectionString: 'postgresql://localhost:5432/myapp' }),
	cacheLayer({ redisUrl: 'redis://localhost:6379' }),
	emailLayer({ apiKey: 'email-api-key-123' })
)
	.to(userRepositoryLayer())
	.to(Layer.merge(userServiceLayer(), notificationServiceLayer()))
	.to(appServiceLayer());

// Working example - providing everything needed step by step
export const workingExampleApp = Layer.merge(
	databaseLayer({ connectionString: 'postgresql://localhost:5432/myapp' }),
	cacheLayer({ redisUrl: 'redis://localhost:6379' }),
	emailLayer({ apiKey: 'email-api-key-123' })
)
	.to(userRepositoryLayer()) // Database -> UserRepository ✓
	.to(userServiceLayer()) // UserRepository + Cache -> UserService ✓
	.to(notificationServiceLayer()) // Email -> NotificationService ✓
	.to(appServiceLayer()); // UserService + NotificationService -> AppService ✓

// Usage example with step-by-step composition
export async function demonstrateLayerUsage() {
	const finalContainer = completeApplication.register(container());

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

	// Clean up
	await finalContainer.destroy();
}

// Usage example with one-go composition
export async function demonstrateOneGoLayerUsage() {
	const appContainer = container();
	const finalContainer = completeApplicationOneGo.register(appContainer);

	const app = await finalContainer.get(AppService);

	const user = await app.registerUser({
		name: 'Jane Smith',
		email: 'jane@example.com',
	});

	console.log('User registered via one-go composition:', user);
	await finalContainer.destroy();
}

// Alternative composition patterns

// Example with many infrastructure layers
export const bigInfrastructureLayer = Layer.merge(
	databaseLayer({ connectionString: 'postgresql://localhost:5432/myapp' }),
	cacheLayer({ redisUrl: 'redis://localhost:6379' }),
	emailLayer({ apiKey: 'email-api-key-123' }),
	// Could add more...
	layer<never, typeof DatabaseConnection, { connectionString: string }>(
		(container, { connectionString }) =>
			container.register(
				DatabaseConnection,
				() => new DatabaseConnection(connectionString)
			)
	)({ connectionString: 'backup-db' }),
	layer<never, typeof CacheService, { redisUrl: string }>(
		(container, { redisUrl }) =>
			container.register(CacheService, () => new CacheService(redisUrl))
	)({ redisUrl: 'backup-cache' })
);

// Complete app using merge for business services too
export const completeAppWithmerge = Layer.merge(
	databaseLayer({ connectionString: 'postgresql://localhost:5432/myapp' }),
	cacheLayer({ redisUrl: 'redis://localhost:6379' }),
	emailLayer({ apiKey: 'email-api-key-123' })
)
	.to(userRepositoryLayer())
	.to(Layer.merge(userServiceLayer(), notificationServiceLayer()))
	.to(appServiceLayer());

// Partial applications for specific use cases
export const n = infrastructure
	.to(userRepositoryLayer())
	.to(userServiceLayer());

export const notificationsOnly = emailLayer({ apiKey: 'prod-email-key' }).to(
	notificationServiceLayer()
);

// Type test - the complete application should require nothing external (never)
// and provide all the services we defined
export async function testCompleteApplication() {
	const appContainer = container();

	// This should work - completeApplication requires `never` (no external dependencies)
	const finalContainer = completeApplication.register(appContainer);

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
