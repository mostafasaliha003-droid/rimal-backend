import PillowHero from './PillowHero';
import SearchController from './search/SearchController';

export default function HeroSearchSection({ onSearch, initialSearch, isSearching, searchError }) {
    return <>
        <PillowHero member />
        <SearchController onSearch={onSearch} initialSearch={initialSearch} isSearching={isSearching} searchError={searchError} />
    </>;
}
