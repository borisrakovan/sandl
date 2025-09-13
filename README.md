# Kore

**⚠️ This project is under heavy development and APIs may change.**

A dependency injection framework for TypeScript that emphasizes complete type safety, modular architecture, and scope management.

## Key Features

### Complete Type Safety

- **Zero runtime errors**: All dependencies are validated at compile time
- **Automatic type inference**: Container knows exactly what services are available
- **Constructor-based DI**: Dependencies are inferred from class constructors

```typescript
import { container, Tag } from 'kore';

class DatabaseService extends Tag.Class('DatabaseService') {
	query() {
		return ['data'];
	}
}

const c = container().register(DatabaseService, () => new DatabaseService());

// ✅ TypeScript knows DatabaseService is available
const db = await c.get(DatabaseService);

// ❌ Compile error - UserService not registered
const user = await c.get(UserService); // Type error
```

### Modular Architecture with Layers

Organize dependencies into composable layers that promote clean architecture:

```typescript
// Infrastructure layer
const databaseLayer = layer<never, typeof DatabaseService>((container) =>
	container.register(DatabaseService, () => new DatabaseService())
);

// Service layer that depends on infrastructure
const userServiceLayer = layer<typeof DatabaseService, typeof UserService>(
	(container) =>
		container.register(
			UserService,
			async (c) => new UserService(await c.get(DatabaseService))
		)
);

// Compose layers
const appLayer = databaseLayer().to(userServiceLayer());

const app = appLayer.register(container());
```

### Advanced Scope Management

Built-in support for request/runtime scopes with automatic cleanup:

```typescript
// Runtime-scoped dependencies (shared across requests)
const runtime = scopedContainer('runtime').register(DatabaseService, {
	factory: () => new DatabaseService(),
	finalizer: (db) => db.disconnect(),
});

// Request-scoped dependencies (per-request instances)
const request = runtime.child('request').register(
	UserService,
	async (c) => new UserService(await c.get(DatabaseService)) // Uses runtime DB
);

// Lambda handler example
export const handler = async (event, context) => {
	const requestContainer = runtime.child('request');

	try {
		const userService = await requestContainer.get(UserService);
		return await userService.handleRequest(event);
	} finally {
		await requestContainer.destroy(); // Cleanup request scope
	}
};
```

## Usage Examples

### Basic Container Usage

```typescript
import { container, Tag } from 'kore';

class EmailService extends Tag.Class('EmailService') {
	sendEmail(to: string, subject: string) {
		return { messageId: 'msg-123' };
	}
}

class UserService extends Tag.Class('UserService') {
	constructor(private emailService: EmailService) {
		super();
	}

	async createUser(email: string) {
		// Create user logic
		await this.emailService.sendEmail(email, 'Welcome!');
	}
}

const app = container()
	.register(EmailService, () => new EmailService())
	.register(
		UserService,
		async (c) => new UserService(await c.get(EmailService))
	);

const userService = await app.get(UserService);
```

### Service Pattern with Auto-Composition

```typescript
import { service, Layer } from 'kore';

const emailService = service(EmailService, () => new EmailService());
const userService = service(
	UserService,
	async (container) => new UserService(await container.get(EmailService))
);

// Automatic dependency resolution
const app = emailService().to(userService()).register(container());
```

### Value Tags for Configuration

```typescript
const ApiKeyTag = Tag.of('apiKey')<string>();
const ConfigTag = Tag.of('config')<{ dbUrl: string }>();

class DatabaseService extends Tag.Class('DatabaseService') {
	constructor(
		private config: Inject<typeof ConfigTag>,
		private apiKey: Inject<typeof ApiKeyTag>
	) {
		super();
	}
}

const app = container()
	.register(ApiKeyTag, () => process.env.API_KEY!)
	.register(ConfigTag, () => ({ dbUrl: 'postgresql://localhost' }))
	.register(
		DatabaseService,
		async (c) =>
			new DatabaseService(await c.get(ConfigTag), await c.get(ApiKeyTag))
	);
```


### Complex Layer Composition

```typescript
// Infrastructure layers
const databaseLayer = layer<never, typeof DatabaseService>((container) =>
	container.register(DatabaseService, () => new DatabaseService())
);

const cacheLayer = layer<never, typeof CacheService>((container) =>
	container.register(CacheService, () => new CacheService())
);

// Business logic layer
const userServiceLayer = layer<
	typeof DatabaseService | typeof CacheService,
	typeof UserService
>((container) =>
	container.register(
		UserService,
		async (c) =>
			new UserService(
				await c.get(DatabaseService),
				await c.get(CacheService)
			)
	)
);

// Compose everything
const fullApplication = Layer.merge(databaseLayer(), cacheLayer()).to(
	userServiceLayer()
);

const app = fullApplication.register(container());
```

## Benefits

- **Type Safety**: Eliminates entire classes of runtime errors
- **Modular Design**: Layer system naturally guides you toward clean architecture
- **Performance**: Zero runtime overhead for dependency resolution
- **Flexibility**: Powerful scope management for any use case (web servers, serverless, etc.)
- **Developer Experience**: IntelliSense works perfectly, no magic strings
- **Testing**: Easy to mock dependencies and create isolated test containers

## License

MIT
