/**
 * Phonetic provider factory.
 *
 * Only providers that actually return phonetics are created here. AI definitions are handled by the translation module,
 * and are no longer disguised as an IPhoneticProvider.
 */

import { IPhoneticProvider } from './IPhoneticProvider';
import { DictionaryApiProvider } from './DictionaryApiProvider';

export class PhoneticProviderFactory {
  private static defaultProvider: IPhoneticProvider | null = null;

  static createProvider(): IPhoneticProvider {
    if (!this.defaultProvider) {
      this.defaultProvider = new DictionaryApiProvider();
    }

    return this.defaultProvider;
  }

  static getDefaultProvider(): IPhoneticProvider {
    return this.createProvider();
  }

  static clearInstances(): void {
    this.defaultProvider = null;
  }
}
