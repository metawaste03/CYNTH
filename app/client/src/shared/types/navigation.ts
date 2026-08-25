import type { IconName } from '../components/Icon/Icon';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: IconName;
}
