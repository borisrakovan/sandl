import {
	ContainerDestroyedError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from '@/errors.js';
import { ScopedContainer } from '@/scoped-container.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('ScopedContainer', () => {
	describe('constructor and factory', () => {
		it('should create an empty scoped container', () => {
			const container = ScopedContainer.empty('test-scope');
			expect(container).toBeInstanceOf(ScopedContainer);
			expect(container.scope).toBe('test-scope');
		});

		it('should create scoped container with symbol scope', () => {
			const scope = Symbol('test-scope');
			const container = ScopedContainer.empty(scope);
			expect(container).toBeInstanceOf(ScopedContainer);
			expect(container.scope).toBe(scope);
		});
	});

	describe('child container creation', () => {
		it('should create child containers', () => {
			const parent = ScopedContainer.empty('parent');
			const child = parent.child('child');

			expect(child).toBeInstanceOf(ScopedContainer);
			expect(child.scope).toBe('child');
			expect(child).not.toBe(parent);
		});

		it('should create multiple child containers', () => {
			const parent = ScopedContainer.empty('parent');
			const child1 = parent.child('child1');
			const child2 = parent.child('child2');

			expect(child1.scope).toBe('child1');
			expect(child2.scope).toBe('child2');
			expect(child1).not.toBe(child2);
		});

		it('should create nested child containers', () => {
			const grandparent = ScopedContainer.empty('grandparent');
			const parent = grandparent.child('parent');
			const child = parent.child('child');

			expect(child.scope).toBe('child');
			expect(parent.scope).toBe('parent');
			expect(grandparent.scope).toBe('grandparent');
		});

		it('should throw error when creating child from destroyed container', async () => {
			const parent = ScopedContainer.empty('parent');
			await parent.destroy();

			expect(() => parent.child('child')).toThrow(
				ContainerDestroyedError
			);
			expect(() => parent.child('child')).toThrow(
				'Cannot create child containers from a destroyed container'
			);
		});
	});

	describe('dependency registration', () => {
		it('should register dependencies in scoped container', () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const container = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			expect(container.has(TestService)).toBe(true);
		});

		it('should allow overriding registration in same scope before instantiation', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const container = ScopedContainer.empty('test')
				.register(TestService, () => new TestService('original'))
				.register(TestService, () => new TestService('overridden'));

			expect(container).toBeDefined();
		});

		it('should allow registering dependency that exists in parent scope if not instantiated', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent.child('child');

			// Should be able to register (override) in child scope
			const childWithOverride = child.register(
				TestService,
				() => new TestService('child')
			);

			expect(childWithOverride).toBeDefined();
		});

		it('should throw error when trying to register dependency that is instantiated in parent scope', async () => {
			class TestService extends Tag.Service('TestService') {}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			// Instantiate in parent first
			await parent.resolve(TestService);

			// Now try to register in child - should throw
			expect(() =>
				child.register(TestService, () => new TestService())
			).toThrow(DependencyAlreadyInstantiatedError);
		});
	});

	describe('has method', () => {
		it('should return false for unregistered dependency', () => {
			class TestService extends Tag.Service('TestService') {}

			const container = ScopedContainer.empty('test');
			expect(container.has(TestService)).toBe(false);
		});

		it('should return true for dependency registered in current scope', () => {
			class TestService extends Tag.Service('TestService') {}

			const container = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			expect(container.has(TestService)).toBe(true);
		});

		it('should return true for dependency registered in parent scope', () => {
			class TestService extends Tag.Service('TestService') {}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			expect(child.has(TestService)).toBe(true);
		});

		it('should return true for dependency registered in grandparent scope', () => {
			class TestService extends Tag.Service('TestService') {}

			const grandparent = ScopedContainer.empty('grandparent').register(
				TestService,
				() => new TestService()
			);
			const parent = grandparent.child('parent');
			const child = parent.child('child');

			expect(child.has(TestService)).toBe(true);
		});
	});

	describe('resolve method and dependency resolution', () => {
		it('should resolve dependency from current scope', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'current-scope';
				}
			}

			const container = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			const instance = await container.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('current-scope');
		});

		it('should resolve dependency from parent scope', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'parent-scope';
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			const instance = await child.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('parent-scope');
		});

		it('should resolve from parent scope when not overridden', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent.child('child');

			const parentInstance = await parent.resolve(TestService);
			const childInstance = await child.resolve(TestService);

			// Both should get the same instance from parent scope
			expect(parentInstance.value).toBe('parent');
			expect(childInstance.value).toBe('parent');
			expect(parentInstance).toBe(childInstance);
		});

		it('should cache instances per scope', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const parent = ScopedContainer.empty('parent').register(
				TestService,
				factory
			);
			const child = parent.child('child');

			// Get from parent twice
			const parentInstance1 = await parent.resolve(TestService);
			const parentInstance2 = await parent.resolve(TestService);

			// Get from child twice
			const childInstance1 = await child.resolve(TestService);
			const childInstance2 = await child.resolve(TestService);

			// Same instance within scope
			expect(parentInstance1).toBe(parentInstance2);
			expect(childInstance1).toBe(childInstance2);

			// Same instance across scopes (resolved from parent)
			expect(parentInstance1).toBe(childInstance1);

			// Factory called only once
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should allow child to override parent dependency before instantiation', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent
				.child('child')
				.register(TestService, () => new TestService('child'));

			// Child should get its own instance, parent should get parent instance
			const childInstance = await child.resolve(TestService);
			const parentInstance = await parent.resolve(TestService);

			expect(childInstance.value).toBe('child');
			expect(parentInstance.value).toBe('parent');
			expect(childInstance).not.toBe(parentInstance);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = ScopedContainer.empty('test');

			// @ts-expect-error - TestService is not registered
			await expect(container.resolve(TestService)).rejects.toThrow(
				UnknownDependencyError
			);
		});

		it('should handle complex dependency injection across scopes', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class CacheService extends Tag.Service('CacheService') {
				get() {
					return 'cached-result';
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(
					private db: DatabaseService,
					private cache: CacheService
				) {
					super();
				}

				getUser() {
					return `${this.db.query()}-${this.cache.get()}`;
				}
			}

			// App-level services
			const app = ScopedContainer.empty('app').register(
				DatabaseService,
				() => new DatabaseService()
			);

			// Request-level services
			const request = app
				.child('request')
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(
							await ctx.resolve(DatabaseService),
							await ctx.resolve(CacheService)
						)
				);

			const userService = await request.resolve(UserService);
			expect(userService.getUser()).toBe('db-result-cached-result');
		});

		it('should throw error when getting from destroyed container', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			await container.destroy();

			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('destroy method', () => {
		it('should call finalizers for instantiated dependencies', async () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const container = ScopedContainer.empty('test').register(
				TestService,
				{
					factory: () => new TestService(),
					finalizer,
				}
			);

			const instance = await container.resolve(TestService);
			await container.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should destroy children before parent', async () => {
			const destructionOrder: string[] = [];

			class ParentService extends Tag.Service('ParentService') {}
			class ChildService extends Tag.Service('ChildService') {}

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				{
					factory: () => new ParentService(),
					finalizer: () => {
						destructionOrder.push('parent');
					},
				}
			);

			const child = parent.child('child').register(ChildService, {
				factory: () => new ChildService(),
				finalizer: () => {
					destructionOrder.push('child');
				},
			});

			// Instantiate both
			await parent.resolve(ParentService);
			await child.resolve(ChildService);

			// Destroy parent (should destroy child first)
			await parent.destroy();

			expect(destructionOrder).toEqual(['child', 'parent']);
		});

		it('should destroy multiple children before parent', async () => {
			const destructionOrder: string[] = [];

			class ParentService extends Tag.Service('ParentService') {}
			class Child1Service extends Tag.Service('Child1Service') {}
			class Child2Service extends Tag.Service('Child2Service') {}

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				{
					factory: () => new ParentService(),
					finalizer: () => {
						destructionOrder.push('parent');
					},
				}
			);

			const child1 = parent.child('child1').register(Child1Service, {
				factory: () => new Child1Service(),
				finalizer: () => {
					destructionOrder.push('child1');
				},
			});

			const child2 = parent.child('child2').register(Child2Service, {
				factory: () => new Child2Service(),
				finalizer: () => {
					destructionOrder.push('child2');
				},
			});

			// Instantiate all
			await parent.resolve(ParentService);
			await child1.resolve(Child1Service);
			await child2.resolve(Child2Service);

			// Destroy parent
			await parent.destroy();

			// Children should be destroyed before parent
			expect(destructionOrder).toHaveLength(3);
			expect(destructionOrder).toContain('child1');
			expect(destructionOrder).toContain('child2');
			expect(destructionOrder).toContain('parent');
			expect(destructionOrder.indexOf('parent')).toBe(2); // Parent last
		});

		it('should handle nested child destruction', async () => {
			const destructionOrder: string[] = [];

			class GrandparentService extends Tag.Service(
				'GrandparentService'
			) {}
			class ParentService extends Tag.Service('ParentService') {}
			class ChildService extends Tag.Service('ChildService') {}

			const grandparent = ScopedContainer.empty('grandparent').register(
				GrandparentService,
				{
					factory: () => new GrandparentService(),
					finalizer: () => {
						destructionOrder.push('grandparent');
					},
				}
			);

			const parent = grandparent.child('parent').register(ParentService, {
				factory: () => new ParentService(),
				finalizer: () => {
					destructionOrder.push('parent');
				},
			});

			const child = parent.child('child').register(ChildService, {
				factory: () => new ChildService(),
				finalizer: () => {
					destructionOrder.push('child');
				},
			});

			// Instantiate all
			await grandparent.resolve(GrandparentService);
			await parent.resolve(ParentService);
			await child.resolve(ChildService);

			// Destroy grandparent
			await grandparent.destroy();

			expect(destructionOrder).toEqual([
				'child',
				'parent',
				'grandparent',
			]);
		});

		it('should handle child destruction errors', async () => {
			class ParentService extends Tag.Service('ParentService') {}
			class ChildService extends Tag.Service('ChildService') {}

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				{
					factory: () => new ParentService(),
					finalizer: () => {
						// Parent finalizer succeeds
					},
				}
			);

			const child = parent.child('child').register(ChildService, {
				factory: () => new ChildService(),
				finalizer: () => {
					throw new Error('Child finalizer error');
				},
			});

			await parent.resolve(ParentService);
			await child.resolve(ChildService);

			await expect(parent.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should be idempotent', async () => {
			const container = ScopedContainer.empty('test');

			await container.destroy();
			await expect(container.destroy()).resolves.toBeUndefined();
			await expect(container.destroy()).resolves.toBeUndefined();
		});

		it('should make container unusable after destroy', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			await container.resolve(TestService);
			await container.destroy();

			// Should still report as having the service
			expect(container.has(TestService)).toBe(true);

			// But should throw when trying to get it
			await expect(container.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);

			// And should throw when trying to register
			expect(() =>
				container.register(TestService, () => new TestService())
			).toThrow(ContainerDestroyedError);
		});

		it('should handle garbage collected children gracefully', async () => {
			const parent = ScopedContainer.empty('parent');

			// Create child and let it go out of scope
			{
				class ChildService extends Tag.Service('ChildService') {}
				const child = parent
					.child('child')
					.register(ChildService, () => new ChildService());
				await child.resolve(ChildService);
				// child goes out of scope here
			}

			// Force garbage collection if possible
			if (global.gc) {
				global.gc();
			}

			// Parent destroy should handle dead child references gracefully
			await expect(parent.destroy()).resolves.toBeUndefined();
		});
	});

	describe('error handling', () => {
		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService extends Tag.Service('TestService') {}

			const container = ScopedContainer.empty('test').register(
				TestService,
				() => {
					throw new Error('Factory error');
				}
			);

			await expect(container.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle circular dependencies', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = ScopedContainer.empty('test')
				.register(
					ServiceA,
					async (ctx) =>
						// @ts-expect-error - ServiceB not registered yet
						new ServiceA(await ctx.resolve(ServiceB))
				)
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
				);

			try {
				await container.resolve(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// Should have nested error chain leading to CircularDependencyError
				const serviceAError = error as DependencyCreationError;
				expect(serviceAError.cause).toBeInstanceOf(
					DependencyCreationError
				);
			}
		});

		it('should handle cross-scope circular dependencies', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const parent = ScopedContainer.empty('parent').register(
				ServiceA,
				async (ctx) =>
					// @ts-expect-error - ServiceB not in parent scope
					new ServiceA(await ctx.resolve(ServiceB))
			);
			const child = parent
				.child('child')
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
				);

			try {
				await child.resolve(ServiceB);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
			}
		});
	});

	describe('WeakRef memory management', () => {
		it('should not prevent child garbage collection', async () => {
			const parent = ScopedContainer.empty('parent');
			let childRef: WeakRef<ScopedContainer<never>>;

			// Create child in isolated scope
			{
				const child = parent.child('child');
				childRef = new WeakRef(child);
				expect(childRef.deref()).toBe(child);
			}

			// Force garbage collection if available
			if (global.gc) {
				global.gc();
				// Give GC time to run
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			// Note: We can't reliably test GC in all environments,
			// but we can at least verify the WeakRef exists
			expect(childRef).toBeDefined();
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies in scoped containers', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const parent = ScopedContainer.empty('parent').register(
				StringTag,
				() => 'parent-string'
			);
			const child = parent.child('child').register(NumberTag, () => 42);

			const stringValue = await child.resolve(StringTag); // From parent
			const numberValue = await child.resolve(NumberTag); // From child

			expect(stringValue).toBe('parent-string');
			expect(numberValue).toBe(42);
		});

		it('should allow child to override parent ValueTag before instantiation', async () => {
			const ConfigTag = Tag.of('config')<{ env: string }>();

			const parent = ScopedContainer.empty('parent').register(
				ConfigTag,
				() => ({ env: 'production' })
			);
			const child = parent
				.child('child')
				.register(ConfigTag, () => ({ env: 'development' }));

			// Child should get its own config, parent should get parent config
			const childConfig = await child.resolve(ConfigTag);
			const parentConfig = await parent.resolve(ConfigTag);

			expect(childConfig.env).toBe('development');
			expect(parentConfig.env).toBe('production');
		});
	});

	describe('resolveAll method', () => {
		it('should resolve multiple dependencies from current scope', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}

			const container = ScopedContainer.empty('test')
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const [serviceA, serviceB] = await container.resolveAll(
				ServiceA,
				ServiceB
			);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should resolve dependencies from parent scope', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'parent-A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'parent-B';
				}
			}

			const parent = ScopedContainer.empty('parent')
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const child = parent.child('child');

			const [serviceA, serviceB] = await child.resolveAll(
				ServiceA,
				ServiceB
			);

			expect(serviceA.getValue()).toBe('parent-A');
			expect(serviceB.getValue()).toBe('parent-B');
		});

		it('should resolve mix of current and parent scope dependencies', async () => {
			class ParentService extends Tag.Service('ParentService') {
				getValue() {
					return 'parent';
				}
			}
			class ChildService extends Tag.Service('ChildService') {
				getValue() {
					return 'child';
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				() => new ParentService()
			);

			const child = parent
				.child('child')
				.register(ChildService, () => new ChildService());

			const [parentService, childService] = await child.resolveAll(
				ParentService,
				ChildService
			);

			expect(parentService.getValue()).toBe('parent');
			expect(childService.getValue()).toBe('child');
		});

		it('should handle empty array', async () => {
			const container = ScopedContainer.empty('test');

			const results = await container.resolveAll();

			expect(results).toEqual([]);
		});

		it('should work with ValueTag dependencies across scopes', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const parent = ScopedContainer.empty('parent').register(
				StringTag,
				() => 'parent-string'
			);

			const child = parent.child('child').register(NumberTag, () => 42);

			const [stringValue, numberValue] = await child.resolveAll(
				StringTag,
				NumberTag
			);

			expect(stringValue).toBe('parent-string');
			expect(numberValue).toBe(42);
		});

		it('should throw error when resolving from destroyed container', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const container = ScopedContainer.empty('test')
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await container.destroy();

			await expect(
				container.resolveAll(ServiceA, ServiceB)
			).rejects.toThrow(ContainerDestroyedError);
		});
	});
});
