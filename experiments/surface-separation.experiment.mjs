import {makeFixtures} from '../surface-separation-fixtures.mjs';
import {installSurfaceSeparation} from '../surface-separation-view.mjs';

export default {
  id: 'surface-separation',
  title: 'Surface separation',
  async create({host, record}) {
    const session = await host.scene.open();
    let controller;
    try {
      const height = host.scene.ground().height;
      const fixtures = makeFixtures(height);
      for (const fixture of fixtures) {
        fixture.asset = await session.attach(fixture.root, {
          owned: true,
          metadata: {label: fixture.root.name, source: `study:surface-separation:${fixture.spec.id}`},
        });
      }
      host.controls.document.defaultView.kaminosSelection.clear();
      controller = await installSurfaceSeparation({host, record, session, fixtures});
      session.setView({position: [.95, height + 4.8, 11.6], target: [0, height + 2.18, 0]});
      return {
        ...controller,
        async dispose() {
          controller.dispose();
          await session.dispose();
        },
      };
    } catch (error) {
      controller?.dispose();
      await session.dispose();
      throw error;
    }
  },
};
