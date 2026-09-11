export type OrganisationType = 'hub' | 'manufacturer' | 'contractor' | 'certifier';

export interface OrganisationBranding {
  logoUrl?: string;
  primaryColour?: string;
  description?: string;
  website?: string;
}

export interface Organisation {
  id: string;
  name: string;
  type: OrganisationType;
  slug: string;
  branding?: OrganisationBranding;
  verified: boolean;
  blockchainAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}
