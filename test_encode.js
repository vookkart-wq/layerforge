// Test LinkedIn URL encoding with apostrophe fix
const testUrl = "https://www.linkedin.com/company/saturday's-gravy";

console.log('Input URL:', testUrl);

// Apply the FIXED encoding logic
const encodeLinkedIn = (v) => {
    if (!v) return v;
    if (v.includes('/in/')) {
        const [base, rest] = v.split('/in/');
        const slug = (rest || '').split('/')[0].split('?')[0];
        return base + '/in/' + encodeURIComponent(slug).replace(/'/g, '%27');
    }
    if (v.includes('/company/')) {
        const [base, rest] = v.split('/company/');
        const slug = (rest || '').split('/')[0].split('?')[0];
        return base + '/company/' + encodeURIComponent(slug).replace(/'/g, '%27');
    }
    return v;
};

const result = encodeLinkedIn(testUrl);
console.log('Output URL:', result);
console.log('');
console.log('Contains %27:', result.includes("%27"));
console.log('');
if (result.includes("%27")) {
    console.log('SUCCESS! Apostrophe is now encoded as %27');
} else {
    console.log('FAILED - still has apostrophe');
}
