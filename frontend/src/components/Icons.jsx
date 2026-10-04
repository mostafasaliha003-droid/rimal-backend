import {
    BedDouble,
    CalendarDays,
    Check,
    MapPin,
    Star,
    UsersRound
} from 'lucide-react';

const iconProps = { strokeWidth: 1.8, 'aria-hidden': true };

export const PinIcon = (props) => <MapPin {...iconProps} {...props} />;
export const CalendarIcon = (props) => <CalendarDays {...iconProps} {...props} />;
export const UsersIcon = (props) => <UsersRound {...iconProps} {...props} />;
export const StarIcon = (props) => <Star {...iconProps} {...props} />;
export const CheckIcon = (props) => <Check {...iconProps} {...props} />;
export const BedIcon = (props) => <BedDouble {...iconProps} {...props} />;
