# Sandly

**⚠️ This project is under heavy development and APIs may change.**

Dependency injection for TypeScript that actually uses the type system. No runtime reflection, no experimental decorators, just compile-time type safety that prevents entire classes of bugs before your code ever runs.

The name **Sandly** comes from **S**ervices **and** **L**a**y**ers - the two core abstractions for organizing dependencies in large applications.

## Why Sandly?

Most TypeScript DI libraries rely on experimental decorators and runtime reflection, losing type safety in the process. Sandly takes a different approach: the container tracks every registered dependency at the type level, making it impossible to resolve unregistered dependencies or create circular dependency chains without TypeScript catching it at compile time.

```typescript
import { Container, Tag } from 'sandly';

class UserService extends Tag.Service('UserService') {
	getUsers() {
		return ['alice', 'bob'];
	}
}

const container = Container.empty().register(
	UserService,
	() => new UserService()
);

// ✅ TypeScript knows UserService is registered
const users = await container.resolve(UserService);

// ❌ TypeScript error - OrderService not registered
const orders = await container.resolve(OrderService);
// Error: Argument of type 'typeof OrderService' is not assignable to parameter of type 'never'
```

## Installation

```bash
npm install sandly
# or
pnpm add sandly
# or
yarn add sandly
```

Requires TypeScript 5.0+ and Node.js 18+ (uses AsyncLocalStorage for circular dependency detection).

## Quick Start

Here's a complete example showing dependency injection with automatic cleanup:

```typescript
import { Container, Tag } from 'sandly';

// Define services using Tag.Service
class Database extends Tag.Service('Database') {
	async query(sql: string) {
		console.log(`Executing: ${sql}`);
		return [{ id: 1, name: 'Alice' }];
	}

	async close() {
		console.log('Database connection closed');
	}
}

class UserRepository extends Tag.Service('UserRepository') {
	constructor(private db: Database) {
		super();
	}

	async findAll() {
		return this.db.query('SELECT * FROM users');
	}
}

// Register services with their factories
const container = Container.empty()
	.register(Database, {
		factory: () => new Database(),
		finalizer: (db) => db.close(), // Cleanup when container is destroyed
	})
	.register(
		UserRepository,
		async (ctx) => new UserRepository(await ctx.resolve(Database))
	);

// Use the services
const userRepo = await container.resolve(UserRepository);
const users = await userRepo.findAll();
console.log(users); // [{ id: 1, name: 'Alice' }]

// Clean up all resources
await container.destroy(); // Calls db.close()
```

**Key concepts:**

- **Tags** identify dependencies. Use `Tag.Service()` for classes or `Tag.of()` for values.
- **Container** manages service instantiation and caching. Each service is created once (singleton).
- **Factories** create service instances and can resolve other dependencies via the resolution context.
- **Finalizers** (optional) clean up resources when the container is destroyed.

For larger applications, use **Layers** to organize dependencies into composable modules:

```typescript
import { layer, autoService, Container } from 'sandly';

// Layer that provides Database
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, {
		factory: () => new Database(),
		finalizer: (db) => db.close(),
	})
);

// Layer that provides UserRepository (depends on Database)
const userRepositoryLayer = autoService(UserRepository, [Database]);

// Compose layers - userRepositoryLayer.provide(databaseLayer) creates
// a complete layer with all dependencies satisfied
const appLayer = userRepositoryLayer.provide(databaseLayer);

// Apply to container
const container = appLayer.register(Container.empty());
const userRepo = await container.resolve(UserRepository);
```

Continue reading to learn about all features including value tags, layer composition, scope management, and testing patterns.

## Main Features

### Type Safety

The container tracks registered dependencies in its generic type parameters, making it impossible to resolve unregistered dependencies.

```typescript
import { Container, Tag } from 'sandly';

class CacheService extends Tag.Service('CacheService') {
	get(key: string) {
		return null;
	}
}

class EmailService extends Tag.Service('EmailService') {
	send(to: string) {}
}

// Container knows exactly what's registered
const container = Container.empty().register(
	CacheService,
	() => new CacheService()
);
// Type: Container<typeof CacheService>

// ✅ Works - CacheService is registered
const cache = await container.resolve(CacheService);

// ❌ TypeScript error - EmailService not registered
const email = await container.resolve(EmailService);
// Error: Argument of type 'typeof EmailService' is not assignable
// to parameter of type 'typeof CacheService'
```

Type information is preserved through method chaining:

```typescript
const container = Container.empty()
	.register(CacheService, () => new CacheService())
	.register(EmailService, () => new EmailService());
// Type: Container<typeof CacheService | typeof EmailService>

// Now both work
const cache = await container.resolve(CacheService);
const email = await container.resolve(EmailService);
```

Dependencies are tracked in factory functions too:

```typescript
class UserService extends Tag.Service('UserService') {
	constructor(
		private cache: CacheService,
		private email: EmailService
	) {
		super();
	}
}

// Factory resolution context only allows registered dependencies
const container = Container.empty()
	.register(CacheService, () => new CacheService())
	.register(EmailService, () => new EmailService())
	.register(UserService, async (ctx) => {
		// ctx.resolve() only accepts CacheService or EmailService
		return new UserService(
			await ctx.resolve(CacheService),
			await ctx.resolve(EmailService)
		);
	});
```

### Modular Architecture with Layers

For large applications, organizing dependencies into layers helps manage complexity and makes dependencies composable.

```typescript
import { layer, service, value, Tag, Container } from 'sandly';

// Configuration layer - provides primitive values
const ApiKeyTag = Tag.of('ApiKey')<string>();
const DatabaseUrlTag = Tag.of('DatabaseUrl')<string>();

const configLayer = Layer.mergeAll(
	value(ApiKeyTag, process.env.API_KEY!),
	value(DatabaseUrlTag, process.env.DATABASE_URL!)
);

// Infrastructure layer - depends on config
class Database extends Tag.Service('Database') {
	constructor(private url: string) {
		super();
	}

	async query(sql: string) {
		console.log(`Querying ${this.url}: ${sql}`);
		return [];
	}
}

const databaseLayer = layer<typeof DatabaseUrlTag, typeof Database>(
	(container) =>
		container.register(Database, async (ctx) => {
			const url = await ctx.resolve(DatabaseUrlTag);
			return new Database(url);
		})
);

// Service layer - depends on infrastructure
class UserService extends Tag.Service('UserService') {
	constructor(private db: Database) {
		super();
	}

	async getUsers() {
		return this.db.query('SELECT * FROM users');
	}
}

const userServiceLayer = service(
	UserService,
	async (ctx) => new UserService(await ctx.resolve(Database))
);

// Compose into complete application layer
// Dependencies flow: configLayer -> databaseLayer -> userServiceLayer
const appLayer = userServiceLayer.provide(databaseLayer).provide(configLayer);

// Apply to container - all dependencies satisfied
const container = appLayer.register(Container.empty());
const userService = await container.resolve(UserService);
```

### Flexible Dependency Values

Any value can be a dependency, not just class instances:

```typescript
import { Tag, value, Container } from 'sandly';

// Primitive values
const PortTag = Tag.of('Port')<number>();
const DebugModeTag = Tag.of('DebugMode')<boolean>();

// Configuration objects
interface AppConfig {
	apiUrl: string;
	timeout: number;
	retries: number;
}
const ConfigTag = Tag.of('Config')<AppConfig>();

// Even functions
type Logger = (msg: string) => void;
const LoggerTag = Tag.of('Logger')<Logger>();

const container = Container.empty()
	.register(PortTag, () => 3000)
	.register(DebugModeTag, () => process.env.NODE_ENV === 'development')
	.register(ConfigTag, () => ({
		apiUrl: 'https://api.example.com',
		timeout: 5000,
		retries: 3,
	}))
	.register(LoggerTag, () => (msg: string) => console.log(msg));

const port = await container.resolve(PortTag); // number
const config = await container.resolve(ConfigTag); // AppConfig
```

### Async Lifecycle Management

Both service creation and cleanup can be asynchronous:

```typescript
import { Container, Tag } from 'sandly';

class DatabaseConnection extends Tag.Service('DatabaseConnection') {
	private connection: any = null;

	async connect() {
		console.log('Connecting to database...');
		await new Promise((resolve) => setTimeout(resolve, 100));
		this.connection = {
			/* connection object */
		};
		console.log('Connected!');
	}

	async disconnect() {
		console.log('Disconnecting from database...');
		await new Promise((resolve) => setTimeout(resolve, 50));
		this.connection = null;
		console.log('Disconnected!');
	}

	query(sql: string) {
		if (!this.connection) throw new Error('Not connected');
		return [];
	}
}

const container = Container.empty().register(DatabaseConnection, {
	factory: async () => {
		const db = new DatabaseConnection();
		await db.connect(); // Async initialization
		return db;
	},
	finalizer: async (db) => {
		await db.disconnect(); // Async cleanup
	},
});

// Use the service
const db = await container.resolve(DatabaseConnection);
await db.query('SELECT * FROM users');

// Clean shutdown
await container.destroy();
// Output:
// Disconnecting from database...
// Disconnected!
```

### Powerful Scope Management

Scoped containers enable hierarchical dependency management - perfect for web servers where some services live for the application lifetime while others are request-specific:

```typescript
import { ScopedContainer, Tag } from 'sandly';

// Application-level (singleton)
class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

// Request-level
class RequestContext extends Tag.Service('RequestContext') {
	constructor(public requestId: string) {
		super();
	}
}

// Set up application container with shared services
const rootContainer = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);

// For each HTTP request, create a child scope
async function handleRequest(requestId: string) {
	const requestContainer = rootContainer.child('request');

	requestContainer.register(
		RequestContext,
		() => new RequestContext(requestId)
	);

	const ctx = await requestContainer.resolve(RequestContext);
	const db = await requestContainer.resolve(Database); // From parent scope

	// Clean up request scope only
	await requestContainer.destroy();
}

// Each request gets isolated scope, but shares Database
await handleRequest('req-1');
await handleRequest('req-2');
```

### Performance & Developer Experience

**Zero runtime overhead for resolution**: Dependency resolution uses a simple `Map` lookup. Services are instantiated once and cached.

**No third-party dependencies**: The library has zero runtime dependencies, keeping your bundle size small.

**No experimental decorators**: Works with standard TypeScript - no special compiler flags or deprecated decorator metadata.

**IntelliSense works perfectly**: Because dependencies are tracked at the type level, your IDE knows exactly what's available:

```typescript
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Cache, () => new Cache());

// IDE autocomplete shows: Database | Cache
await container.resolve(/* IDE suggests Database and Cache */);
```

**Lazy instantiation**: Services are only created when first resolved:

```typescript
const container = Container.empty()
	.register(ExpensiveService, () => {
		console.log('Creating expensive service...');
		return new ExpensiveService();
	})
	.register(CheapService, () => {
		console.log('Creating cheap service...');
		return new CheapService();
	});

// Nothing instantiated yet
await container.resolve(CheapService);
// Output: "Creating cheap service..."
// ExpensiveService never created unless resolved
```

### Easy Testing

Create test containers with real or mocked services:

```typescript
import { Container, Tag } from 'sandly';

class EmailService extends Tag.Service('EmailService') {
	async send(to: string, body: string) {
		/* real implementation */
	}
}

class UserService extends Tag.Service('UserService') {
	constructor(private email: EmailService) {
		super();
	}

	async registerUser(email: string) {
		await this.email.send(email, 'Welcome!');
	}
}

// Test with mock EmailService
const mockEmail = { send: vi.fn() };

const testContainer = Container.empty()
	.register(EmailService, () => mockEmail as EmailService)
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(EmailService))
	);

const userService = await testContainer.resolve(UserService);
await userService.registerUser('test@example.com');

expect(mockEmail.send).toHaveBeenCalledWith('test@example.com', 'Welcome!');
```

## Core Concepts

Before diving into detailed usage, let's understand the four main building blocks of Sandly.

### Tags

Tags are unique identifiers for dependencies. They come in two flavors:

**ServiceTag** - For class-based dependencies. Created by extending `Tag.Service()`:

```typescript
class UserRepository extends Tag.Service('UserRepository') {
	findUser(id: string) {
		return { id, name: 'Alice' };
	}
}
```

The class itself serves as both the tag and the implementation. The string identifier must be unique across your application.

**ValueTag** - For non-class dependencies (primitives, objects, functions). Created with `Tag.of()`:

```typescript
const ApiKeyTag = Tag.of('ApiKey')<string>();
const ConfigTag = Tag.of('Config')<{ port: number }>();
```

ValueTags separate the identifier from the value type. The string identifier must be unique, which is why configuration values are the main use case (be careful with generic names like `'port'` or `'config'` - prefer namespaced identifiers like `'app.port'`).

### Container

The container manages the lifecycle of your dependencies. It handles:

- **Registration**: Associating tags with factory functions
- **Resolution**: Creating and caching service instances
- **Dependency injection**: Making dependencies available to factories
- **Lifecycle management**: Calling finalizers when destroyed

```typescript
const container = Container.empty()
	.register(Database, () => new Database())
	.register(
		UserRepository,
		async (ctx) => new UserRepository(await ctx.resolve(Database))
	);

const repo = await container.resolve(UserRepository);
await container.destroy(); // Clean up
```

Each service is instantiated once (singleton pattern). The container tracks what's registered at the type level, preventing resolution of unregistered dependencies at compile time.

### Layers

Layers are composable units of dependency registrations. Think of them as blueprints that can be combined and reused:

```typescript
// A layer is a function that registers dependencies
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, () => new Database())
);

// Layers can depend on other layers
const repositoryLayer = layer<typeof Database, typeof UserRepository>(
	(container) =>
		container.register(
			UserRepository,
			async (ctx) => new UserRepository(await ctx.resolve(Database))
		)
);

// Compose layers to build complete dependency graphs
const appLayer = repositoryLayer.provide(databaseLayer);
```

Layers have two type parameters: requirements (what they need) and provisions (what they provide). This allows TypeScript to verify that all dependencies are satisfied when composing layers.

Layers help avoid "requirement leakage" where service methods expose their dependencies in return types. With layers, dependencies are provided once during construction, keeping service interfaces clean.

### Scopes

Scoped containers enable hierarchical dependency management. They're useful when you have:

- **Application-level services** that live for the entire app lifetime (database connections, configuration)
- **Request-level services** that should be created and destroyed per request (request context, user session)
- **Other scopes** like transactions, background jobs, or Lambda invocations

```typescript
// Root scope with shared services
const rootContainer = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);

// Child scope for each request
const requestContainer = rootContainer.child('request');
requestContainer.register(RequestContext, () => new RequestContext());

// Child can access parent services
const db = await requestContainer.resolve(Database); // From parent

// Destroying child doesn't affect parent
await requestContainer.destroy();
```

Child scopes inherit access to parent dependencies but maintain their own cache. This means a request-scoped service gets its own instance, while application-scoped services are shared across all requests.

## Working with Containers

This section covers direct container usage. For larger applications, you'll typically use layers instead (covered in the next section), but understanding containers is essential.

### Creating a Container

Start with an empty container:

```typescript
import { Container } from 'sandly';

const container = Container.empty();
// Type: Container<never> - no services registered yet
```

### Registering Dependencies

#### Service Tags (Classes)

Register a class by providing a factory function:

```typescript
import { Tag } from 'sandly';

class Logger extends Tag.Service('Logger') {
	log(msg: string) {
		console.log(`[${new Date().toISOString()}] ${msg}`);
	}
}

const container = Container.empty().register(Logger, () => new Logger());
// Type: Container<typeof Logger>
```

The factory receives a resolution context for injecting dependencies:

```typescript
class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findAll() {
		this.logger.log('Finding all users');
		return this.db.query('SELECT * FROM users');
	}
}

const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(UserRepository, async (ctx) => {
		// ctx provides resolve() and resolveAll()
		const [db, logger] = await ctx.resolveAll(Database, Logger);
		return new UserRepository(db, logger);
	});
```

#### Value Tags (Non-Classes)

Register values using `Tag.of()`:

```typescript
const PortTag = Tag.of('server.port')<number>();
const DatabaseUrlTag = Tag.of('database.url')<string>();

interface AppConfig {
	apiKey: string;
	timeout: number;
}
const ConfigTag = Tag.of('app.config')<AppConfig>();

const container = Container.empty()
	.register(PortTag, () => 3000)
	.register(DatabaseUrlTag, () => process.env.DATABASE_URL!)
	.register(ConfigTag, () => ({
		apiKey: process.env.API_KEY!,
		timeout: 5000,
	}));
```

### Resolving Dependencies

Use `resolve()` to get a service instance:

```typescript
const logger = await container.resolve(Logger);
logger.log('Hello!');

// TypeScript error - UserRepository not registered
const repo = await container.resolve(UserRepository);
// Error: Argument of type 'typeof UserRepository' is not assignable...
```

Resolve multiple dependencies at once:

```typescript
const [db, logger] = await container.resolveAll(Database, Logger);
// Returns tuple with correct types: [Database, Logger]
```

Services are singletons - always the same instance:

```typescript
const logger1 = await container.resolve(Logger);
const logger2 = await container.resolve(Logger);

console.log(logger1 === logger2); // true
```

### Lifecycle Management

#### Finalizers for Cleanup

Register finalizers to clean up resources when the container is destroyed:

```typescript
class DatabaseConnection extends Tag.Service('DatabaseConnection') {
	private connected = false;

	async connect() {
		this.connected = true;
		console.log('Connected');
	}

	async disconnect() {
		this.connected = false;
		console.log('Disconnected');
	}

	query(sql: string) {
		if (!this.connected) throw new Error('Not connected');
		return [];
	}
}

const container = Container.empty().register(DatabaseConnection, {
	factory: async () => {
		const db = new DatabaseConnection();
		await db.connect();
		return db;
	},
	finalizer: async (db) => {
		await db.disconnect();
	},
});

// Use the service
const db = await container.resolve(DatabaseConnection);
await db.query('SELECT 1');

// Clean up
await container.destroy();
// Output: "Disconnected"
```

All finalizers run concurrently when you call `destroy()`:

```typescript
const container = Container.empty()
	.register(Database, {
		factory: () => new Database(),
		finalizer: (db) => db.close(),
	})
	.register(Cache, {
		factory: () => new Cache(),
		finalizer: (cache) => cache.clear(),
	});

// Both finalizers run in parallel
await container.destroy();
```

If any finalizer fails, cleanup continues for others and a `DependencyFinalizationError` is thrown with details of all failures.

#### Overriding Registrations

You can override a registration before it's instantiated:

```typescript
const container = Container.empty()
	.register(Logger, () => new ConsoleLogger())
	.register(Logger, () => new FileLogger()); // Overrides previous

const logger = await container.resolve(Logger);
// Gets FileLogger instance
```

But you cannot override after instantiation:

```typescript
const container = Container.empty().register(Logger, () => new Logger());

const logger = await container.resolve(Logger); // Instantiated

container.register(Logger, () => new Logger()); // Throws!
// DependencyAlreadyInstantiatedError: Cannot register dependency Logger -
// it has already been instantiated
```

### Container Methods

#### has() - Check if Registered

```typescript
const container = Container.empty().register(Logger, () => new Logger());

console.log(container.has(Logger)); // true
console.log(container.has(Database)); // false
```

#### exists() - Check if Instantiated

```typescript
const container = Container.empty().register(Logger, () => new Logger());

console.log(container.exists(Logger)); // false - not instantiated yet

await container.resolve(Logger);

console.log(container.exists(Logger)); // true - now instantiated
```

### Error Handling

#### Unknown Dependency

```typescript
const container = Container.empty();

try {
	await container.resolve(Logger);
} catch (error) {
	console.log(error instanceof UnknownDependencyError); // true
	console.log(error.message); // "No factory registered for dependency Logger"
}
```

#### Circular Dependencies

Circular dependencies are detected at runtime:

```typescript
class ServiceA extends Tag.Service('ServiceA') {}
class ServiceB extends Tag.Service('ServiceB') {}

const container = Container.empty()
	.register(ServiceA, async (ctx) => {
		await ctx.resolve(ServiceB);
		return new ServiceA();
	})
	.register(ServiceB, async (ctx) => {
		await ctx.resolve(ServiceA); // Circular!
		return new ServiceB();
	});

try {
	await container.resolve(ServiceA);
} catch (error) {
	console.log(error instanceof CircularDependencyError); // true
	console.log(error.message);
	// "Circular dependency detected for ServiceA: ServiceA -> ServiceB -> ServiceA"
}
```

The error includes the full dependency chain to help debug the issue.

#### Creation Errors

If a factory throws, the error is wrapped in `DependencyCreationError`:

```typescript
const container = Container.empty().register(Database, () => {
	throw new Error('Connection failed');
});

try {
	await container.resolve(Database);
} catch (error) {
	console.log(error instanceof DependencyCreationError); // true
	console.log(error.cause); // Original Error: Connection failed
}
```

### Type Safety in Action

The container's type parameter tracks all registered dependencies:

```typescript
const c1 = Container.empty();
// Type: Container<never>

const c2 = c1.register(Database, () => new Database());
// Type: Container<typeof Database>

const c3 = c2.register(Logger, () => new Logger());
// Type: Container<typeof Database | typeof Logger>

// TypeScript knows what's available
await c3.resolve(Database); // ✅ OK
await c3.resolve(Logger); // ✅ OK
await c3.resolve(Cache); // ❌ Type error
```

Factory functions have typed resolution contexts:

```typescript
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(UserService, async (ctx) => {
		// ctx can only resolve Database or Logger
		await ctx.resolve(Database); // ✅ OK
		await ctx.resolve(Logger); // ✅ OK
		await ctx.resolve(Cache); // ❌ Type error

		return new UserService();
	});
```

### Best Practices

**Use method chaining** - Each `register()` returns the container with updated types:

```typescript
// ✅ Good - types flow through chain
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger())
	.register(
		UserService,
		async (ctx) =>
			new UserService(
				await ctx.resolve(Database),
				await ctx.resolve(Logger)
			)
	);

// ❌ Bad - lose type information
const container = Container.empty();
container.register(Database, () => new Database());
container.register(Logger, () => new Logger());
// TypeScript doesn't track these registrations
```

**Use namespaced identifiers for ValueTags** - Prevents collisions:

```typescript
// ❌ Generic names can collide
const Port = Tag.of('port')<number>();
const Timeout = Tag.of('timeout')<number>();

// ✅ Namespaced identifiers
const ServerPort = Tag.of('server.port')<number>();
const HttpTimeout = Tag.of('http.timeout')<number>();
```

**Prefer layers for multiple dependencies** - Once you have 3+ services, layers become cleaner:

```typescript
// Containers work for small setups
const container = Container.empty()
	.register(Database, () => new Database())
	.register(Logger, () => new Logger());

// But layers are better for larger dependency graphs (see next section)
```

**Handle cleanup errors** - Finalizers can fail:

```typescript
try {
	await container.destroy();
} catch (error) {
	if (error instanceof DependencyFinalizationError) {
		console.error('Cleanup failed:', error.detail.errors);
		// Continue with shutdown anyway
	}
}
```

**Don't resolve during registration** - Keep registration and resolution separate:

```typescript
// ❌ Bad - resolving during setup creates timing issues
const container = Container.empty().register(Logger, () => new Logger());

const logger = await container.resolve(Logger); // During setup!

container.register(Database, () => new Database());

// ✅ Good - register everything first, then resolve
const container = Container.empty()
	.register(Logger, () => new Logger())
	.register(Database, () => new Database());

// Now use services
const logger = await container.resolve(Logger);
```

## Working with Layers

Layers are the recommended approach for organizing dependencies in larger applications. They provide composability, prevent requirement leakage, and make dependency graphs explicit at the type level.

### Why Use Layers?

**Problem: Manual Dependency Wiring**

Without layers, you manually wire up dependencies everywhere you need them:

```typescript
// ❌ Manual wiring in every place you build the container
const container = Container.empty()
	.register(Config, () => loadConfig())
	.register(Database, async (ctx) => new Database(await ctx.resolve(Config)))
	.register(Logger, () => new Logger())
	.register(
		UserService,
		async (ctx) =>
			new UserService(
				await ctx.resolve(Database),
				await ctx.resolve(Logger)
			)
	)
	.register(
		OrderService,
		async (ctx) =>
			new OrderService(
				await ctx.resolve(Database),
				await ctx.resolve(Logger)
			)
	);
// Dependencies repeated everywhere, hard to refactor
```

**Solution: Composable Dependency Modules**

Layers let you organize dependencies into reusable, composable modules:

```typescript
// ✅ Dependencies organized into layers
const configLayer = value(ConfigTag, loadConfig());
const databaseLayer = service(
	Database,
	async (ctx) => new Database(await ctx.resolve(ConfigTag))
);
const loggerLayer = service(Logger, () => new Logger());

const userServiceLayer = autoService(UserService, [Database, Logger]);
const orderServiceLayer = autoService(OrderService, [Database, Logger]);

// Compose once
const appLayer = Layer.mergeAll(userServiceLayer, orderServiceLayer).provide(
	Layer.mergeAll(databaseLayer, loggerLayer, configLayer)
);

// Apply to container
const container = appLayer.register(Container.empty());
```

Layers provide:

- **Modularity**: Group related dependencies together
- **Reusability**: Compose layers across different contexts (tests, dev, prod)
- **Type safety**: Requirements and provisions tracked at the type level
- **Encapsulation**: Hide internal dependencies from consumers

### Creating Layers

#### layer() - Manual Layer Creation

The `layer()` function creates a layer by providing a registration function:

```typescript
import { layer, Container } from 'sandly';

class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

// Must annotate layer type parameters manually
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, () => new Database())
);

// Apply to container
const container = databaseLayer.register(Container.empty());
const db = await container.resolve(Database);
```

**Type parameters:**

- First: Requirements (what the layer needs) - `never` means no requirements
- Second: Provisions (what the layer provides) - `typeof Database`

With dependencies:

```typescript
class Logger extends Tag.Service('Logger') {
	log(msg: string) {
		console.log(msg);
	}
}

class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findAll() {
		this.logger.log('Finding all users');
		return this.db.query('SELECT * FROM users');
	}
}

// Requires Database and Logger, provides UserRepository
const userRepositoryLayer = layer<
	typeof Database | typeof Logger,
	typeof UserRepository
>((container) =>
	container.register(UserRepository, async (ctx) => {
		const [db, logger] = await ctx.resolveAll(Database, Logger);
		return new UserRepository(db, logger);
	})
);
```

#### service() - Service Layer Helper

The `service()` function is a convenience wrapper for creating service layers:

```typescript
import { service } from 'sandly';

// Simpler than layer() - infers types from the factory
const userRepositoryLayer = service(UserRepository, async (ctx) => {
	const [db, logger] = await ctx.resolveAll(Database, Logger);
	return new UserRepository(db, logger);
});

// With finalizer
const databaseLayer = service(Database, {
	factory: async () => {
		const db = new Database();
		await db.connect();
		return db;
	},
	finalizer: (db) => db.disconnect(),
});
```

The dependencies are automatically inferred from the factory's resolution context.

#### autoService() - Automatic Constructor Injection

The `autoService()` function automatically injects dependencies based on constructor parameters:

```typescript
import { autoService } from 'sandly';

class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findAll() {
		this.logger.log('Finding all users');
		return this.db.query('SELECT * FROM users');
	}
}

// Automatically resolves Database and Logger from constructor
const userRepositoryLayer = autoService(UserRepository, [Database, Logger]);
```

Mix ServiceTag dependencies, ValueTag dependencies, and static values:

```typescript
const ApiKeyTag = Tag.of('ApiKey')<string>();
const TimeoutTag = Tag.of('Timeout')<number>();

class ApiClient extends Tag.Service('ApiClient') {
	constructor(
		private logger: Logger, // ServiceTag - works automatically
		private apiKey: Inject<typeof ApiKeyTag>, // ValueTag - needs Inject<>
		private timeout: Inject<typeof TimeoutTag>, // ValueTag - needs Inject<>
		private baseUrl: string // Static value
	) {
		super();
	}
}

// Order matters - must match constructor parameter order
const apiClientLayer = autoService(ApiClient, [
	Logger, // ServiceTag - resolved from container
	ApiKeyTag, // ValueTag - resolved from container
	TimeoutTag, // ValueTag - resolved from container
	'https://api.example.com', // Static value - passed directly
]);
```

**Important**: ValueTag dependencies in constructors must be annotated with `Inject<typeof YourTag>`. This preserves type information for `service()` and `autoService()` to infer the dependency. Without `Inject<>`, TypeScript sees it as a regular value and `service()` and `autoService()` won't know to resolve it from the container.

With finalizer:

```typescript
const databaseLayer = autoService(Database, {
	dependencies: ['postgresql://localhost:5432/mydb'],
	finalizer: (db) => db.disconnect(),
});
```

#### value() - Value Layer Helper

The `value()` function creates a layer that provides a constant value:

```typescript
import { value, Tag } from 'sandly';

const ApiKeyTag = Tag.of('ApiKey')<string>();
const PortTag = Tag.of('Port')<number>();

const apiKeyLayer = value(ApiKeyTag, 'my-secret-key');
const portLayer = value(PortTag, 3000);

// Combine value layers
const configLayer = Layer.mergeAll(
	apiKeyLayer,
	portLayer,
	value(Tag.of('Debug')<boolean>(), true)
);
```

### Using Inject<> for ValueTag Dependencies

When using ValueTags as constructor parameters with `autoService()`, you must annotate them with `Inject<>`:

```typescript
import { Tag, Inject, autoService } from 'sandly';

const ApiKeyTag = Tag.of('ApiKey')<string>();
const TimeoutTag = Tag.of('Timeout')<number>();

class ApiClient extends Tag.Service('ApiClient') {
	constructor(
		private logger: Logger, // ServiceTag - works automatically
		private apiKey: Inject<typeof ApiKeyTag>, // ValueTag - needs Inject<>
		private timeout: Inject<typeof TimeoutTag> // ValueTag - needs Inject<>
	) {
		super();
	}

	async get(endpoint: string) {
		// this.apiKey is typed as string (the actual value type)
		// this.timeout is typed as number
		return fetch(endpoint, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			signal: AbortSignal.timeout(this.timeout),
		});
	}
}

// autoService infers dependencies from constructor
const apiClientLayer = autoService(ApiClient, [
	Logger, // ServiceTag
	ApiKeyTag, // ValueTag - resolved from container
	TimeoutTag, // ValueTag - resolved from container
]);
```

`Inject<>` is a type-level marker that:

- Keeps the actual value type (string, number, etc.)
- Allows dependency inference for `autoService()`
- Has no runtime overhead

### Composing Layers

Layers can be combined in three ways: **provide**, **provideMerge**, and **merge**.

#### .provide() - Sequential Composition

Provides dependencies to a layer, hiding the dependency layer's provisions in the result:

```typescript
const configLayer = layer<never, typeof ConfigTag>((container) =>
	container.register(ConfigTag, () => loadConfig())
);

const databaseLayer = layer<typeof ConfigTag, typeof Database>((container) =>
	container.register(Database, async (ctx) => {
		const config = await ctx.resolve(ConfigTag);
		return new Database(config);
	})
);

// Database layer needs ConfigTag, which configLayer provides
const infraLayer = databaseLayer.provide(configLayer);
// Type: Layer<never, typeof Database>
// Note: ConfigTag is hidden - it's an internal detail
```

The type signature:

```typescript
Layer<TRequires, TProvides>.provide(
  dependency: Layer<TDepReq, TDepProv>
) => Layer<TDepReq | Exclude<TRequires, TDepProv>, TProvides>
```

Reading left-to-right (natural flow):

```typescript
const appLayer = serviceLayer // needs: Database, Logger
	.provide(infraLayer) // needs: Config, provides: Database, Logger
	.provide(configLayer); // needs: nothing, provides: Config
// Result: Layer<never, typeof UserService>
```

#### .provideMerge() - Composition with Merged Provisions

Like `.provide()` but includes both layers' provisions in the result:

```typescript
const infraLayer = databaseLayer.provideMerge(configLayer);
// Type: Layer<never, typeof ConfigTag | typeof Database>
// Both ConfigTag and Database are available
```

Use when you want to expose multiple layers' services:

```typescript
const AppConfigTag = Tag.of('AppConfig')<AppConfig>();

const configLayer = value(AppConfigTag, loadConfig());
const databaseLayer = layer<typeof AppConfigTag, typeof Database>((container) =>
	container.register(
		Database,
		async (ctx) => new Database(await ctx.resolve(AppConfigTag))
	)
);

// Expose both config and database
const infraLayer = databaseLayer.provideMerge(configLayer);
// Type: Layer<never, typeof AppConfigTag | typeof Database>

// Services can use both
const container = infraLayer.register(Container.empty());
const config = await container.resolve(AppConfigTag); // Available!
const db = await container.resolve(Database); // Available!
```

#### .merge() - Parallel Combination

Merges two independent layers (no dependency relationship):

```typescript
const databaseLayer = layer<never, typeof Database>((container) =>
	container.register(Database, () => new Database())
);

const loggerLayer = layer<never, typeof Logger>((container) =>
	container.register(Logger, () => new Logger())
);

// Combine independent layers
const infraLayer = databaseLayer.merge(loggerLayer);
// Type: Layer<never, typeof Database | typeof Logger>
```

For multiple layers, use `Layer.mergeAll()`:

```typescript
const infraLayer = Layer.mergeAll(
	databaseLayer,
	loggerLayer,
	cacheLayer,
	metricsLayer
);
```

### Static Layer Methods

#### Layer.empty()

Creates an empty layer (no requirements, no provisions):

```typescript
import { Layer } from 'sandly';

const emptyLayer = Layer.empty();
// Type: Layer<never, never>
```

#### Layer.merge()

Merges exactly two layers:

```typescript
const combined = Layer.merge(databaseLayer, loggerLayer);
// Equivalent to: databaseLayer.merge(loggerLayer)
```

#### Layer.mergeAll()

Merges multiple layers at once:

```typescript
const infraLayer = Layer.mergeAll(
	value(ApiKeyTag, 'key'),
	value(PortTag, 3000),
	databaseLayer,
	loggerLayer
);
// Type: Layer<Requirements, Provisions> with all merged
```

Requires at least 2 layers.

### Applying Layers to Containers

Use the `.register()` method to apply a layer to a container:

```typescript
const appLayer = userServiceLayer.provide(databaseLayer).provide(configLayer);

// Apply to container
const container = appLayer.register(Container.empty());

// Now resolve services
const userService = await container.resolve(UserService);
```

Layers can be applied to containers that already have services:

```typescript
const baseContainer = Container.empty().register(Logger, () => new Logger());

// Apply layer to container with existing services
const container = databaseLayer.register(baseContainer);
// Container now has both Logger and Database
```

### Complete Example

Here's a realistic multi-layer application:

```typescript
import {
	layer,
	service,
	autoService,
	value,
	Tag,
	Layer,
	Container,
} from 'sandly';

// ============ Configuration Layer ============
const ApiKeyTag = Tag.of('config.apiKey')<string>();
const DatabaseUrlTag = Tag.of('config.databaseUrl')<string>();

const configLayer = Layer.mergeAll(
	value(ApiKeyTag, process.env.API_KEY!),
	value(DatabaseUrlTag, process.env.DATABASE_URL!)
);

// ============ Infrastructure Layer ============
class Logger extends Tag.Service('Logger') {
	log(msg: string) {
		console.log(`[LOG] ${msg}`);
	}
}

class Database extends Tag.Service('Database') {
	constructor(private url: string) {
		super();
	}

	async query(sql: string) {
		return [];
	}
}

const loggerLayer = service(Logger, () => new Logger());

const databaseLayer = service(Database, async (ctx) => {
	const url = await ctx.resolve(DatabaseUrlTag);
	return new Database(url);
});

const infraLayer = Layer.mergeAll(loggerLayer, databaseLayer).provide(
	configLayer
);

// ============ Repository Layer ============
class UserRepository extends Tag.Service('UserRepository') {
	constructor(
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async findById(id: string) {
		this.logger.log(`Finding user ${id}`);
		return this.db.query(`SELECT * FROM users WHERE id = '${id}'`);
	}
}

const userRepositoryLayer = autoService(UserRepository, [Database, Logger]);

// ============ Service Layer ============
class UserService extends Tag.Service('UserService') {
	constructor(
		private repo: UserRepository,
		private logger: Logger,
		private apiKey: Inject<typeof ApiKeyTag>
	) {
		super();
	}

	async getUser(id: string) {
		this.logger.log(`UserService.getUser(${id})`);
		const user = await this.repo.findById(id);
		// Use apiKey for external API calls...
		return user;
	}
}

const userServiceLayer = autoService(UserService, [
	UserRepository,
	Logger,
	ApiKeyTag,
]);

// ============ Compose Application ============
const appLayer = userServiceLayer
	.provide(userRepositoryLayer)
	.provide(infraLayer);

// ============ Bootstrap ============
const container = appLayer.register(Container.empty());
const userService = await container.resolve(UserService);

// Use the service
const user = await userService.getUser('123');
```

### Best Practices

**Always annotate layer<> type parameters manually:**

```typescript
// ✅ Good - explicit types
const myLayer = layer<typeof Requirement, typeof Provision>((container) =>
	container.register(Provision, async (ctx) => {
		const req = await ctx.resolve(Requirement);
		return new Provision(req);
	})
);

// ❌ Bad - inference is difficult/impossible
const myLayer = layer((container) =>
	container.register(Provision, async (ctx) => {
		const req = await ctx.resolve(Requirement);
		return new Provision(req);
	})
);
```

**Follow the types when composing layers:**

Start with the target layer, inspect its type to see requirements, then chain `.provide()` calls:

```typescript
// Start with what you need
const userServiceLayer = service(UserService, ...);
// Type: Layer<typeof Database | typeof Logger, typeof UserService>
//             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ requirements

// Provide those requirements
const appLayer = userServiceLayer
  .provide(Layer.mergeAll(databaseLayer, loggerLayer));
```

**Define layers in the same file as the service class:**

```typescript
// user-repository.ts
export class UserRepository extends Tag.Service('UserRepository') {
	constructor(private db: Database) {
		super();
	}

	async findAll() {
		return this.db.query('SELECT * FROM users');
	}
}

// Layer definition stays with the class
export const userRepositoryLayer = autoService(UserRepository, [Database]);
```

This keeps related code together while keeping the service class decoupled from DI details.

**Resolve dependencies locally:**

When a module has internal dependencies, provide them within the module's layer to avoid leaking implementation details:

```typescript
// user-module/user-validator.ts
export class UserValidator extends Tag.Service('UserValidator') {
	validate(user: User) {
		// Validation logic
	}
}

export const userValidatorLayer = autoService(UserValidator, []);
```

```typescript
// user-module/user-notifier.ts
export class UserNotifier extends Tag.Service('UserNotifier') {
	notify(user: User) {
		// Notification logic
	}
}

export const userNotifierLayer = autoService(UserNotifier, []);
```

```typescript
// user-module/user-service.ts
import { UserValidator, userValidatorLayer } from './user-validator.js';
import { UserNotifier, userNotifierLayer } from './user-notifier.js';

// Public service - external consumers only see this
export class UserService extends Tag.Service('UserService') {
	constructor(
		private validator: UserValidator, // Internal dependency
		private notifier: UserNotifier, // Internal dependency
		private db: Database // External dependency
	) {
		super();
	}

	async createUser(user: User) {
		this.validator.validate(user);
		await this.db.save(user);
		this.notifier.notify(user);
	}
}

// Public layer - provides internal dependencies inline
export const userServiceLayer = autoService(UserService, [
	UserValidator,
	UserNotifier,
	Database,
]).provide(Layer.mergeAll(userValidatorLayer, userNotifierLayer));
// Type: Layer<typeof Database, typeof UserService>

// Consumers of this module only need to provide Database
// UserValidator and UserNotifier are internal details
```

```typescript
// app.ts
import { userServiceLayer } from './user-module/user-service.js';

// Only need to provide Database - internal dependencies already resolved
const appLayer = userServiceLayer.provide(databaseLayer);
```

This pattern:

- **Encapsulates internal dependencies**: Consumers don't need to know about `UserValidator` or `UserNotifier`
- **Reduces coupling**: Changes to internal dependencies don't affect consumers
- **Simplifies usage**: Consumers only provide what the module actually needs externally

**Use provideMerge when you need access to intermediate services:**

```typescript
// Need both config and database in final container
const infraLayer = databaseLayer.provideMerge(configLayer);
// Type: Layer<never, typeof ConfigTag | typeof Database>

// vs. provide hides config
const infraLayer = databaseLayer.provide(configLayer);
// Type: Layer<never, typeof Database> - ConfigTag not accessible
```

**Prefer autoService for simple cases:**

```typescript
// ✅ Simple and clear
const userServiceLayer = autoService(UserService, [Database, Logger]);

// ❌ Verbose for simple case
const userServiceLayer = service(UserService, async (ctx) => {
	const [db, logger] = await ctx.resolveAll(Database, Logger);
	return new UserService(db, logger);
});
```

But use `service()` when you need custom logic:

```typescript
// ✅ Good - custom initialization logic
const databaseLayer = service(Database, {
	factory: async () => {
		const db = new Database();
		await db.connect();
		await db.runMigrations();
		return db;
	},
	finalizer: (db) => db.disconnect(),
});
```

## Scope Management

Scoped containers enable hierarchical dependency management where some services live for different durations. This is essential for applications that handle multiple contexts (HTTP requests, database transactions, background jobs, etc.).

### When to Use Scopes

Use scoped containers when you have dependencies with different lifecycles:

**Web servers**: Application-level services (database pool, config) vs. request-level services (request context, user session)

**Serverless functions**: Function-level services (logger, metrics) vs. invocation-level services (event context, request ID)

**Background jobs**: Worker-level services (job queue, database) vs. job-level services (job context, transaction)

### Creating Scoped Containers

Use `ScopedContainer.empty()` to create a root scope:

```typescript
import { ScopedContainer, Tag } from 'sandly';

class Database extends Tag.Service('Database') {
	query(sql: string) {
		return [];
	}
}

// Create root scope with application-level services
const appContainer = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);
```

The scope identifier (`'app'`) is used for debugging and has no runtime behavior.

### Child Scopes

Create child scopes using `.child()`:

```typescript
class RequestContext extends Tag.Service('RequestContext') {
  constructor(public requestId: string, public userId: string) {
    super();
  }
}

function handleRequest(requestId: string, userId: string) {
  // Create child scope for each request
  const requestScope = appContainer.child('request')
    // Register request-specific services
    .register(RequestContext, () =>
      new RequestContext(requestId, userId)
    )
  );

  // Child can access parent services
  const db = await requestScope.resolve(Database);      // From parent
  const ctx = await requestScope.resolve(RequestContext); // From child

  // Clean up request scope when done
  await requestScope.destroy();
}
```

### Scope Resolution Rules

When resolving a dependency, scoped containers follow these rules:

1. **Check current scope cache**: If already instantiated in this scope, return it
2. **Check current scope factory**: If registered in this scope, create and cache it here
3. **Delegate to parent**: If not in current scope, try parent scope
4. **Throw error**: If not found in any scope, throw `UnknownDependencyError`

```typescript
const appScope = ScopedContainer.empty('app').register(
	Database,
	() => new Database()
);

const requestScope = appScope
	.child('request')
	.register(RequestContext, () => new RequestContext());

// Resolving Database from requestScope:
// 1. Not in requestScope cache
// 2. Not in requestScope factory
// 3. Delegate to appScope -> found and cached in appScope
await requestScope.resolve(Database); // Returns Database from appScope

// Resolving RequestContext from requestScope:
// 1. Not in requestScope cache
// 2. Found in requestScope factory -> create and cache in requestScope
await requestScope.resolve(RequestContext); // Returns RequestContext from requestScope
```

### Complete Web Server Example

Here's a realistic Express.js application with scoped containers:

```typescript
import express from 'express';
import { ScopedContainer, Tag, autoService } from 'sandly';

// ============ Application-Level Services ============
class Database extends Tag.Service('Database') {
	async query(sql: string) {
		// Real database query
		return [];
	}
}

class Logger extends Tag.Service('Logger') {
	log(message: string) {
		console.log(`[${new Date().toISOString()}] ${message}`);
	}
}

// ============ Request-Level Services ============
class RequestContext extends Tag.Service('RequestContext') {
	constructor(
		public requestId: string,
		public userId: string | null,
		public startTime: number
	) {
		super();
	}

	getDuration() {
		return Date.now() - this.startTime;
	}
}

class UserSession extends Tag.Service('UserSession') {
	constructor(
		private ctx: RequestContext,
		private db: Database,
		private logger: Logger
	) {
		super();
	}

	async getCurrentUser() {
		if (!this.ctx.userId) {
			return null;
		}

		this.logger.log(`Fetching user ${this.ctx.userId}`);
		const users = await this.db.query(
			`SELECT * FROM users WHERE id = '${this.ctx.userId}'`
		);
		return users[0] || null;
	}
}

// ============ Setup Application Container ============
const appContainer = ScopedContainer.empty('app')
	.register(Database, () => new Database())
	.register(Logger, () => new Logger());

// ============ Express Middleware ============
const app = express();

// Store request scope in res.locals
app.use((req, res, next) => {
	const requestId = crypto.randomUUID();
	const userId = req.headers['user-id'] as string | undefined;

	// Create child scope for this request
	const requestScope = appContainer.child(`request-${requestId}`);

	// Register request-specific services
	requestScope
		.register(
			RequestContext,
			() => new RequestContext(requestId, userId || null, Date.now())
		)
		.register(
			UserSession,
			async (ctx) =>
				new UserSession(
					await ctx.resolve(RequestContext),
					await ctx.resolve(Database),
					await ctx.resolve(Logger)
				)
		);

	// Store scope for use in route handlers
	res.locals.scope = requestScope;

	// Clean up scope when response finishes
	res.on('finish', async () => {
		await requestScope.destroy();
	});

	next();
});

// ============ Route Handlers ============
app.get('/api/user', async (req, res) => {
	const scope: ScopedContainer<typeof UserSession> = res.locals.scope;

	const session = await scope.resolve(UserSession);
	const user = await session.getCurrentUser();

	if (!user) {
		res.status(401).json({ error: 'Unauthorized' });
		return;
	}

	res.json({ user });
});

app.get('/api/stats', async (req, res) => {
	const scope: ScopedContainer<typeof RequestContext | typeof Database> =
		res.locals.scope;

	const ctx = await scope.resolve(RequestContext);
	const db = await scope.resolve(Database);

	const stats = await db.query('SELECT COUNT(*) FROM users');

	res.json({
		stats,
		requestId: ctx.requestId,
		duration: ctx.getDuration(),
	});
});

// ============ Start Server ============
const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

// ============ Graceful Shutdown ============
process.on('SIGTERM', async () => {
	console.log('Shutting down...');
	await appContainer.destroy();
	process.exit(0);
});
```

### Serverless Function Example

Scoped containers work perfectly for serverless functions where each invocation should have isolated state:

```typescript
import { ScopedContainer, Tag } from 'sandly';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// ============ Function-Level Services (shared across invocations) ============
class Logger extends Tag.Service('Logger') {
	log(level: string, message: string) {
		console.log(JSON.stringify({ level, message, timestamp: Date.now() }));
	}
}

class DynamoDB extends Tag.Service('DynamoDB') {
	async get(table: string, key: string) {
		// AWS SDK call
		return {};
	}
}

// ============ Invocation-Level Services (per Lambda invocation) ============
const EventContextTag = Tag.of('EventContext')<APIGatewayProxyEvent>();
const InvocationIdTag = Tag.of('InvocationId')<string>();

class RequestProcessor extends Tag.Service('RequestProcessor') {
	constructor(
		private event: Inject<typeof EventContextTag>,
		private invocationId: Inject<typeof InvocationIdTag>,
		private db: DynamoDB,
		private logger: Logger
	) {
		super();
	}

	async process() {
		this.logger.log('info', `Processing ${this.invocationId}`);

		const userId = this.event.pathParameters?.userId;
		if (!userId) {
			return { statusCode: 400, body: 'Missing userId' };
		}

		const user = await this.db.get('users', userId);
		return { statusCode: 200, body: JSON.stringify(user) };
	}
}

// ============ Initialize Function-Level Container (cold start) ============
const functionContainer = ScopedContainer.empty('function')
	.register(Logger, () => new Logger())
	.register(DynamoDB, () => new DynamoDB());

// ============ Lambda Handler ============
export async function handler(
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
	const invocationId = crypto.randomUUID();

	// Create invocation scope
	const invocationScope = functionContainer.child(
		`invocation-${invocationId}`
	);

	try {
		// Register invocation-specific context
		invocationScope
			.register(EventContextTag, () => event)
			.register(InvocationIdTag, () => invocationId)
			.register(
				RequestProcessor,
				async (ctx) =>
					new RequestProcessor(
						await ctx.resolve(EventContextTag),
						await ctx.resolve(InvocationIdTag),
						await ctx.resolve(DynamoDB),
						await ctx.resolve(Logger)
					)
			);

		// Process request
		const processor = await invocationScope.resolve(RequestProcessor);
		const result = await processor.process();

		return result;
	} finally {
		// Clean up invocation scope
		await invocationScope.destroy();
	}
}
```

### Scope Destruction Order

When a scope is destroyed, finalizers run in this order:

1. **Child scopes first**: All child scopes are destroyed before the parent
2. **Concurrent finalizers**: Within a scope, finalizers run concurrently
3. **Parent scope last**: Parent finalizers run after all children are cleaned up

```typescript
const appScope = ScopedContainer.empty('app').register(Database, {
	factory: () => new Database(),
	finalizer: (db) => {
		console.log('Closing database');
		return db.close();
	},
});

const request1 = appScope.child('request-1').register(RequestContext, {
	factory: () => new RequestContext('req-1'),
	finalizer: (ctx) => {
		console.log('Cleaning up request-1');
	},
});

const request2 = appScope.child('request-2').register(RequestContext, {
	factory: () => new RequestContext('req-2'),
	finalizer: (ctx) => {
		console.log('Cleaning up request-2');
	},
});

// Destroy parent scope
await appScope.destroy();
// Output:
// Cleaning up request-1
// Cleaning up request-2
// Closing database
```

### Scope Lifecycle Best Practices

**Always destroy child scopes**: Failing to destroy child scopes causes memory leaks:

```typescript
// ❌ Bad - memory leak
app.use((req, res, next) => {
	const requestScope = appContainer.child('request');
	res.locals.scope = requestScope;
	next();
	// Scope never destroyed!
});

// ✅ Good - proper cleanup
app.use((req, res, next) => {
	const requestScope = appContainer.child('request');
	res.locals.scope = requestScope;

	res.on('finish', async () => {
		await requestScope.destroy();
	});

	next();
});
```

**Use try-finally for cleanup**: Ensure scopes are destroyed even if errors occur:

```typescript
// ✅ Good - cleanup guaranteed
async function processRequest() {
	const requestScope = appContainer.child('request');

	try {
		// Process request
		const result = await requestScope.resolve(RequestProcessor);
		return await result.process();
	} finally {
		// Always cleanup, even on error
		await requestScope.destroy();
	}
}
```

**Don't share scopes across async boundaries**: Each context should have its own scope:

```typescript
// ❌ Bad - scope shared across requests
const sharedScope = appContainer.child('shared');

app.get('/api/user', async (req, res) => {
	const service = await sharedScope.resolve(UserService);
	// Multiple requests share the same scope - potential data leaks!
});

// ✅ Good - scope per request
app.get('/api/user', async (req, res) => {
	const requestScope = appContainer.child('request');
	const service = await requestScope.resolve(UserService);
	// Each request gets isolated scope
	await requestScope.destroy();
});
```

**Register request-scoped services in parent scope when possible**: If services don't need request-specific data, register them once:

```typescript
// ❌ Suboptimal - registering service definition per request
app.use((req, res, next) => {
	const requestScope = appContainer.child('request');

	// UserService factory defined repeatedly
	requestScope.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);

	next();
});

// ✅ Better - register service definition once, instantiate per request
const appContainer = ScopedContainer.empty('app')
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);

app.use((req, res, next) => {
	const requestScope = appContainer.child('request');
	// UserService factory already registered in parent
	// First resolve in requestScope will create instance
	next();
});
```

**Use weak references for child tracking**: ScopedContainer uses WeakRef internally for child scope tracking, so destroyed child scopes can be garbage collected even if parent scope is still alive.

### Combining Scopes with Layers

You can apply layers to scoped containers just like regular containers:

```typescript
import { ScopedContainer, Layer, autoService } from 'sandly';

// Define layers
const databaseLayer = autoService(Database, []);
const loggerLayer = autoService(Logger, []);
const infraLayer = Layer.mergeAll(databaseLayer, loggerLayer);

// Apply layers to scoped container
const appContainer = infraLayer.register(ScopedContainer.empty('app'));

// Create child scopes as needed
const requestScope = appContainer.child('request');
```

This combines the benefits of:

- **Layers**: Composable, reusable dependency definitions
- **Scopes**: Hierarchical lifetime management

## Comparison with Alternatives

### vs NestJS

**NestJS**:

- **No Type Safety**: Relies on string tokens and runtime reflection. TypeScript can't validate your dependency graph at compile time. This results in common runtime errors like "Unknown dependency" or "Dependency not found" when NestJS app is run.
- **Decorator-Based**: Uses experimental decorators which are being deprecated in favor of the new TC39 standard.
- **Framework Lock-In**: Tightly coupled to the NestJS framework. You can't use the DI system independently.
- **Heavy**: Pulls in many dependencies and runtime overhead.

**Sandly**:

- **Full Type Safety**: Compile-time validation of your entire dependency graph.
- **No Decorators**: Uses standard TypeScript without experimental features.
- **Framework-Agnostic**: Works with any TypeScript project (Express, Fastify, plain Node.js, serverless, etc.).
- **Lightweight**: Zero runtime dependencies, minimal overhead.

### vs InversifyJS

**InversifyJS**:

- **Complex API**: Requires learning container binding DSL, identifiers, and numerous decorators.
- **Decorator-Heavy**: Relies heavily on experimental decorators.
- **No Async Factories**: Doesn't support async dependency creation out of the box.
- **Weak Type Inference**: Type safety requires manual type annotations everywhere.

**Sandly**:

- **Simple API**: Clean, minimal API surface. Tags, containers, and layers.
- **No Decorators**: Standard TypeScript classes and functions.
- **Async First**: Native support for async factories and finalizers.
- **Strong Type Inference**: Types are automatically inferred from your code.

```typescript
// InversifyJS - Complex and decorator-heavy
const TYPES = {
	Database: Symbol.for('Database'),
	UserService: Symbol.for('UserService'),
};

@injectable()
class UserService {
	constructor(@inject(TYPES.Database) private db: Database) {}
}

container.bind<Database>(TYPES.Database).to(Database).inSingletonScope();
container.bind<UserService>(TYPES.UserService).to(UserService);

// Sandly - Simple and type-safe
class UserService extends Tag.Service('UserService') {
	constructor(private db: Database) {
		super();
	}
}

const container = Container.empty()
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);
```

### vs TSyringe

**TSyringe**:

- **Decorator-Based**: Uses experimental `reflect-metadata` and decorators.
- **No Type-Safe Container**: The container doesn't track what's registered. Easy to request unregistered dependencies and only find out at runtime.
- **No Async Support**: Factories must be synchronous.
- **Global Container**: Relies on a global container which makes testing harder.

**Sandly**:

- **No Decorators**: Standard TypeScript, no experimental features.
- **Type-Safe Container**: Container tracks all registered services. TypeScript prevents requesting unregistered dependencies.
- **Full Async Support**: Factories and finalizers can be async.
- **Explicit Containers**: Create and manage containers explicitly for better testability.

```typescript
// TSyringe - Global container, no compile-time safety
@injectable()
class UserService {
	constructor(@inject('Database') private db: Database) {}
}

container.register('Database', { useClass: Database });
container.register('UserService', { useClass: UserService });

// Will compile but fail at runtime if 'Database' wasn't registered
const service = container.resolve('UserService');

// Sandly - Type-safe, explicit
const container = Container.empty()
	.register(Database, () => new Database())
	.register(
		UserService,
		async (ctx) => new UserService(await ctx.resolve(Database))
	);

// Won't compile if Database isn't registered
const service = await container.resolve(UserService); // Type-safe
```

### vs Effect-TS

**Effect-TS**:

- **Steep Learning Curve**: Requires learning functional programming concepts, Effect type, generators, and extensive API.
- **All-or-Nothing**: Designed as a complete effect system. Hard to adopt incrementally.
- **Functional Programming**: Uses FP paradigms which may not fit all teams or codebases.
- **Large Bundle**: Comprehensive framework with significant bundle size.

**Sandly**:

- **Easy to Learn**: Simple, familiar API. If you know TypeScript classes, you're ready to use Sandly.
- **Incremental Adoption**: Add DI to existing codebases without major refactoring.
- **Pragmatic**: Works with standard OOP and functional styles.
- **Minimal Size**: Tiny library focused on DI only.

**Similarities with Effect**:

- Both provide full type safety for dependency management
- Both use the concept of layers for composable dependency graphs
- Both support complete async lifecycle management

**When to choose Effect**: If you want a complete effect system with error handling, concurrency, streams, and are comfortable with FP paradigms.

**When to choose Sandly**: If you want just dependency injection with great type safety, without the learning curve or the need to adopt an entire effect system.

```typescript
// Effect - Functional, effect-based
import { Effect, Layer, Context } from 'effect';

class Database extends Context.Tag('Database')<Database, DatabaseImpl>() {}

const DatabaseLive = Layer.succeed(Database, new DatabaseImpl());

const program = Effect.gen(function* () {
	const db = yield* Database;
	return yield* db.query('SELECT * FROM users');
});

Effect.runPromise(Effect.provide(program, DatabaseLive));

// Sandly - Pragmatic, class-based
class Database extends Tag.Service('Database') {
	query(sql: string) {
		/* ... */
	}
}

const container = Container.empty().register(Database, () => new Database());

const db = await container.resolve(Database);
const result = await db.query('SELECT * FROM users');
```

### Feature Comparison Table

| Feature                    | Sandly  | NestJS  | InversifyJS | TSyringe | Effect-TS |
| -------------------------- | ------- | ------- | ----------- | -------- | --------- |
| Compile-time type safety   | ✅ Full | ❌ None | ⚠️ Partial  | ❌ None  | ✅ Full   |
| No experimental decorators | ✅      | ❌      | ❌          | ❌       | ✅        |
| Async factories            | ✅      | ✅      | ❌          | ❌       | ✅        |
| Async finalizers           | ✅      | ✅      | ❌          | ❌       | ✅        |
| Framework-agnostic         | ✅      | ❌      | ✅          | ✅       | ✅        |
| Learning curve             | Low     | Medium  | High        | Low      | Very High |
| Bundle size                | Tiny    | Large   | Medium      | Small    | Large     |
| Scoped lifetimes           | ✅      | ✅      | ✅          | ✅       | ✅        |
| Layer composition          | ✅      | ❌      | ❌          | ❌       | ✅        |
| Zero dependencies          | ✅      | ❌      | ❌          | ❌       | ❌        |

### Why Choose Sandly?

Choose Sandly if you want:

- **Type safety** without sacrificing developer experience
- **Dependency injection** without the need for experimental features that may break
- **Clean architecture** with layers and composable modules
- **Async support** for real-world scenarios (database connections, API clients, etc.)
- **Testing-friendly** design with easy mocking and isolation
- **Incremental adoption** in existing codebases
- **Zero runtime dependencies** and minimal overhead

Sandly takes inspiration from Effect-TS's excellent type safety and layer composition, while keeping the API simple and accessible for teams that don't need a full effect system.
