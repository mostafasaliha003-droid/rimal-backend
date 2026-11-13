// Responsive encodings of the existing brand artwork and existing hero photo.
// Sources, hashes and font licenses are retained in assets/brand.
import logo40 from '../assets/brand/logo-40.webp';
import logo80 from '../assets/brand/logo-80.webp';
import logo120 from '../assets/brand/logo-120.webp';
import logo160 from '../assets/brand/logo-160.webp';
import logo240 from '../assets/brand/logo-240.webp';
import heroAvif640 from '../assets/brand/hero-640.avif';
import heroAvif960 from '../assets/brand/hero-960.avif';
import heroAvif1440 from '../assets/brand/hero-1440.avif';
import heroAvif2200 from '../assets/brand/hero-2200.avif';
import heroWebp640 from '../assets/brand/hero-640.webp';
import heroWebp960 from '../assets/brand/hero-960.webp';
import heroWebp1440 from '../assets/brand/hero-1440.webp';
import heroWebp2200 from '../assets/brand/hero-2200.webp';

export const brandLogo = {
    src: logo80,
    srcSet: `${logo40} 40w, ${logo80} 80w, ${logo120} 120w, ${logo160} 160w, ${logo240} 240w`
};

export const heroMedia = {
    src: heroWebp1440,
    avifSrcSet: `${heroAvif640} 640w, ${heroAvif960} 960w, ${heroAvif1440} 1440w, ${heroAvif2200} 2200w`,
    webpSrcSet: `${heroWebp640} 640w, ${heroWebp960} 960w, ${heroWebp1440} 1440w, ${heroWebp2200} 2200w`,
    sizes: '100vw',
    width: 2200,
    height: 3300
};
