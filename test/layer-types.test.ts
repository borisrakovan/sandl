import { container } from '@/di/container.js';
import { Layer, layer } from '@/di/layer.js';
import { Tag } from '@/di/tag.js';
import { describe, expectTypeOf, it } from 'vitest';

describe('Layer Type Safety', () => {
	describe('basic layer types', () => {
		it('should create layer with correct requirement and provision types', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const testLayer = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(ServiceA))
					)
			);

			const layerInstance = testLayer();

			expectTypeOf(layerInstance).toEqualTypeOf<
				Layer<typeof ServiceA, typeof ServiceB>
			>();
		});

		it('should create layer with no requirements', () => {
			class ServiceA extends Tag.Class('ServiceA') {}

			const testLayer = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerInstance = testLayer();

			expectTypeOf(layerInstance).toEqualTypeOf<
				Layer<never, typeof ServiceA>
			>();
		});

		it('should create layer with multiple provisions', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const testLayer = layer<never, typeof ServiceA | typeof ServiceB>(
				(container) =>
					container
						.register(ServiceA, () => new ServiceA())
						.register(ServiceB, () => new ServiceB())
			);

			const layerInstance = testLayer();

			expectTypeOf(layerInstance).toEqualTypeOf<
				Layer<never, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should create layer with multiple requirements and provisions', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}
			class ServiceD extends Tag.Class('ServiceD') {}

			const testLayer = layer<
				typeof ServiceA | typeof ServiceB,
				typeof ServiceC | typeof ServiceD
			>((container) =>
				container
					.register(
						ServiceC,
						async (c) => new ServiceC(await c.get(ServiceA))
					)
					.register(
						ServiceD,
						async (c) => new ServiceD(await c.get(ServiceB))
					)
			);

			const layerInstance = testLayer();

			expectTypeOf(layerInstance).toEqualTypeOf<
				Layer<
					typeof ServiceA | typeof ServiceB,
					typeof ServiceC | typeof ServiceD
				>
			>();
		});
	});

	describe('layer composition with "to"', () => {
		it('should compose layers with correct type inference', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(ServiceA))
					)
			);

			const composedLayer = layerA().to(layerB());

			// ServiceA requirement is satisfied by layerA's provision
			// Result should require nothing and provide both ServiceA and ServiceB
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<never, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should preserve external requirements in composition', () => {
			class ExternalService extends Tag.Class('ExternalService') {}
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const layerA = layer<typeof ExternalService, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (c) => new ServiceA(await c.get(ExternalService))
					)
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(ServiceA))
					)
			);

			const composedLayer = layerA().to(layerB());

			// ExternalService is still required (not satisfied by layerA)
			// Both ServiceA and ServiceB are provided
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<typeof ExternalService, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should handle partial requirement satisfaction', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}
			class ServiceD extends Tag.Class('ServiceD') {}

			// Layer provides ServiceA and ServiceB
			const providerLayer = layer<
				never,
				typeof ServiceA | typeof ServiceB
			>((container) =>
				container
					.register(ServiceA, () => new ServiceA())
					.register(ServiceB, () => new ServiceB())
			);

			// Layer requires ServiceA, ServiceB, and ServiceC; provides ServiceD
			const consumerLayer = layer<
				typeof ServiceA | typeof ServiceB | typeof ServiceC,
				typeof ServiceD
			>((container) =>
				container.register(
					ServiceD,
					async (c) =>
						new ServiceD(
							await c.get(ServiceA),
							await c.get(ServiceB),
							await c.get(ServiceC)
						)
				)
			);

			const composedLayer = providerLayer().to(consumerLayer());

			// ServiceA and ServiceB satisfied, ServiceC still required
			expectTypeOf(composedLayer).toEqualTypeOf<
				Layer<
					typeof ServiceC,
					typeof ServiceA | typeof ServiceB | typeof ServiceD
				>
			>();
		});
	});

	describe('layer merging with "and"', () => {
		it('should merge independent layers correctly', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const mergedLayer = layerA().and(layerB());

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<never, typeof ServiceA | typeof ServiceB>
			>();
		});

		it('should combine requirements from both layers', () => {
			class ExternalA extends Tag.Class('ExternalA') {}
			class ExternalB extends Tag.Class('ExternalB') {}
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const layerA = layer<typeof ExternalA, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (c) => new ServiceA(await c.get(ExternalA))
					)
			);

			const layerB = layer<typeof ExternalB, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(ExternalB))
					)
			);

			const mergedLayer = layerA().and(layerB());

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<
					typeof ExternalA | typeof ExternalB,
					typeof ServiceA | typeof ServiceB
				>
			>();
		});

		it('should handle overlapping requirements', () => {
			class SharedExternal extends Tag.Class('SharedExternal') {}
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const layerA = layer<typeof SharedExternal, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (c) => new ServiceA(await c.get(SharedExternal))
					)
			);

			const layerB = layer<typeof SharedExternal, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(SharedExternal))
					)
			);

			const mergedLayer = layerA().and(layerB());

			// SharedExternal appears in both requirements, but union should deduplicate
			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<typeof SharedExternal, typeof ServiceA | typeof ServiceB>
			>();
		});
	});

	describe('parameterized layers', () => {
		it('should handle parameterized layer factory types', () => {
			interface DatabaseConfig {
				host: string;
				port: number;
			}

			class DatabaseService extends Tag.Class('DatabaseService') {}

			const databaseLayer = layer<
				never,
				typeof DatabaseService,
				DatabaseConfig
			>((container, config: DatabaseConfig) =>
				container.register(
					DatabaseService,
					() => new DatabaseService(config)
				)
			);

			// Before calling with params, should be a function that takes DatabaseConfig
			expectTypeOf(databaseLayer).toEqualTypeOf<
				(params: DatabaseConfig) => Layer<never, typeof DatabaseService>
			>();

			// After calling with params, should return the layer
			const configuredLayer = databaseLayer({
				host: 'localhost',
				port: 5432,
			});
			expectTypeOf(configuredLayer).toEqualTypeOf<
				Layer<never, typeof DatabaseService>
			>();
		});

		it('should handle parameterless layers', () => {
			class ServiceA extends Tag.Class('ServiceA') {}

			const simpleLayer = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			// Should be a parameterless function
			expectTypeOf(simpleLayer).toEqualTypeOf<
				() => Layer<never, typeof ServiceA>
			>();

			const layerInstance = simpleLayer();
			expectTypeOf(layerInstance).toEqualTypeOf<
				Layer<never, typeof ServiceA>
			>();
		});
	});

	describe('value tag support', () => {
		it('should work with value tags', () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const configLayer = layer<
				never,
				typeof StringTag | typeof NumberTag
			>((container) =>
				container
					.register(StringTag, () => 'hello')
					.register(NumberTag, () => 42)
			);

			const layerInstance = configLayer();

			expectTypeOf(layerInstance).toEqualTypeOf<
				Layer<never, typeof StringTag | typeof NumberTag>
			>();
		});

		it('should mix class tags and value tags', () => {
			const ConfigTag = Tag.of('config')<{ apiKey: string }>();
			class ApiService extends Tag.Class('ApiService') {}

			const configLayer = layer<never, typeof ConfigTag>((container) =>
				container.register(ConfigTag, () => ({ apiKey: 'secret' }))
			);

			const serviceLayer = layer<typeof ConfigTag, typeof ApiService>(
				(container) =>
					container.register(
						ApiService,
						async (c) => new ApiService(await c.get(ConfigTag))
					)
			);

			const appLayer = configLayer().to(serviceLayer());

			expectTypeOf(appLayer).toEqualTypeOf<
				Layer<never, typeof ConfigTag | typeof ApiService>
			>();
		});
	});

	describe('Layer utilities type safety', () => {
		it('should type Layer.empty() correctly', () => {
			const emptyLayer = Layer.empty();

			expectTypeOf(emptyLayer).toEqualTypeOf<Layer>();
		});

		it('should type Layer.merge() correctly', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}
			class ExternalA extends Tag.Class('ExternalA') {}
			class ExternalB extends Tag.Class('ExternalB') {}

			const layerA = layer<typeof ExternalA, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (c) => new ServiceA(await c.get(ExternalA))
					)
			);

			const layerB = layer<never, typeof ServiceB>((container) =>
				container.register(ServiceB, () => new ServiceB())
			);

			const layerC = layer<typeof ExternalB, typeof ServiceC>(
				(container) =>
					container.register(
						ServiceC,
						async (c) => new ServiceC(await c.get(ExternalB))
					)
			);

			const mergedLayer = Layer.merge(layerA(), layerB(), layerC());

			expectTypeOf(mergedLayer).toEqualTypeOf<
				Layer<
					typeof ExternalA | typeof ExternalB,
					typeof ServiceA | typeof ServiceB | typeof ServiceC
				>
			>();
		});
	});

	describe('layer register method type constraints', () => {
		it('should constrain layer register to require satisfied dependencies', () => {
			class ExternalService extends Tag.Class('ExternalService') {}
			class ProvidedService extends Tag.Class('ProvidedService') {}

			const testLayer = layer<
				typeof ExternalService,
				typeof ProvidedService
			>((container) =>
				container.register(ProvidedService, async (c) => {
					// Container should have ExternalService available
					expectTypeOf(c.get(ExternalService)).toEqualTypeOf<
						Promise<ExternalService>
					>();

					return new ProvidedService(await c.get(ExternalService));
				})
			);

			const layerInstance = testLayer();

			// Test that the layer can only be applied to containers that provide ExternalService
			const baseContainer = container().register(
				ExternalService,
				() => new ExternalService()
			);
			const finalContainer = layerInstance.register(baseContainer);

			expectTypeOf(finalContainer.get(ProvidedService)).toEqualTypeOf<
				Promise<ProvidedService>
			>();
		});
	});

	describe('complex layer composition scenarios', () => {
		it('should handle deep layer composition chains', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}
			class ServiceD extends Tag.Class('ServiceD') {}

			const layerA = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const layerB = layer<typeof ServiceA, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(ServiceA))
					)
			);

			const layerC = layer<typeof ServiceB, typeof ServiceC>(
				(container) =>
					container.register(
						ServiceC,
						async (c) => new ServiceC(await c.get(ServiceB))
					)
			);

			const layerD = layer<typeof ServiceC, typeof ServiceD>(
				(container) =>
					container.register(
						ServiceD,
						async (c) => new ServiceD(await c.get(ServiceC))
					)
			);

			const finalLayer = layerA().to(layerB()).to(layerC()).to(layerD());

			expectTypeOf(finalLayer).toEqualTypeOf<
				Layer<
					never,
					| typeof ServiceA
					| typeof ServiceB
					| typeof ServiceC
					| typeof ServiceD
				>
			>();
		});

		it('should handle complex mixed composition and merging', () => {
			class BaseService extends Tag.Class('BaseService') {}
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}
			class CompositeService extends Tag.Class('CompositeService') {}

			const baseLayer = layer<never, typeof BaseService>((container) =>
				container.register(BaseService, () => new BaseService())
			);

			const branchA = layer<typeof BaseService, typeof ServiceA>(
				(container) =>
					container.register(
						ServiceA,
						async (c) => new ServiceA(await c.get(BaseService))
					)
			);

			const branchB = layer<typeof BaseService, typeof ServiceB>(
				(container) =>
					container.register(
						ServiceB,
						async (c) => new ServiceB(await c.get(BaseService))
					)
			);

			const independentC = layer<never, typeof ServiceC>((container) =>
				container.register(ServiceC, () => new ServiceC())
			);

			const compositeLayer = layer<
				typeof ServiceA | typeof ServiceB | typeof ServiceC,
				typeof CompositeService
			>((container) =>
				container.register(
					CompositeService,
					async (c) =>
						new CompositeService(
							await c.get(ServiceA),
							await c.get(ServiceB),
							await c.get(ServiceC)
						)
				)
			);

			// Base provides to both branches, merge branches with independent, then compose
			const finalLayer = baseLayer()
				.to(branchA().and(branchB()))
				.and(independentC())
				.to(compositeLayer());

			expectTypeOf(finalLayer).toEqualTypeOf<
				Layer<
					never,
					| typeof BaseService
					| typeof ServiceA
					| typeof ServiceB
					| typeof ServiceC
					| typeof CompositeService
				>
			>();
		});
	});

	describe('error prevention at type level', () => {
		it('should prevent composition of incompatible layers at compile time', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class UnrelatedService extends Tag.Class('UnrelatedService') {}

			const providerLayer = layer<never, typeof ServiceA>((container) =>
				container.register(ServiceA, () => new ServiceA())
			);

			const requiresB = layer<typeof ServiceB, typeof UnrelatedService>(
				(container) =>
					container.register(
						UnrelatedService,
						async (c) => new UnrelatedService(await c.get(ServiceB))
					)
			);

			// This composition should work at type level but leave ServiceB unsatisfied
			const composed = providerLayer().to(requiresB());

			// The result should still require ServiceB since providerLayer doesn't provide it
			expectTypeOf(composed).toEqualTypeOf<
				Layer<
					typeof ServiceB,
					typeof ServiceA | typeof UnrelatedService
				>
			>();
		});
	});
});
