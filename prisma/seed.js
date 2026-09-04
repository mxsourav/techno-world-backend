"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var bcrypt_1 = require("bcrypt");
var fs_1 = require("fs");
var path_1 = require("path");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var hashedPassword, adminEmails, _i, adminEmails_1, email, seedDataPath, seedData, _a, _b, cat, dbCategories, categoryMap, _c, _d, bookData, categoryId, cmsSections, _e, cmsSections_1, section;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, bcrypt_1.default.hash('admin123', 10)];
                case 1:
                    hashedPassword = _f.sent();
                    adminEmails = ['admin', 'admin@technoworld.com', 'admin@example.com'];
                    _i = 0, adminEmails_1 = adminEmails;
                    _f.label = 2;
                case 2:
                    if (!(_i < adminEmails_1.length)) return [3 /*break*/, 5];
                    email = adminEmails_1[_i];
                    return [4 /*yield*/, prisma.user.upsert({
                            where: { email: email },
                            update: {
                                password: hashedPassword,
                                isActive: true,
                                failedLogins: 0,
                                lockedUntil: null,
                                role: client_1.Role.SUPER_ADMIN,
                            },
                            create: {
                                email: email,
                                name: 'Super Admin',
                                password: hashedPassword,
                                role: client_1.Role.SUPER_ADMIN,
                                isActive: true,
                            },
                        })];
                case 3:
                    _f.sent();
                    _f.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5:
                    seedDataPath = path_1.default.resolve(process.cwd(), 'prisma/seedData.json');
                    seedData = JSON.parse(fs_1.default.readFileSync(seedDataPath, 'utf-8'));
                    // Seed Categories
                    console.log("Seeding ".concat(seedData.categories.length, " categories..."));
                    _a = 0, _b = seedData.categories;
                    _f.label = 6;
                case 6:
                    if (!(_a < _b.length)) return [3 /*break*/, 9];
                    cat = _b[_a];
                    return [4 /*yield*/, prisma.category.upsert({
                            where: { slug: cat.slug },
                            update: { name: cat.name },
                            create: { slug: cat.slug, name: cat.name },
                        })];
                case 7:
                    _f.sent();
                    _f.label = 8;
                case 8:
                    _a++;
                    return [3 /*break*/, 6];
                case 9: return [4 /*yield*/, prisma.category.findMany()];
                case 10:
                    dbCategories = _f.sent();
                    categoryMap = new Map(dbCategories.map(function (c) { return [c.slug, c.id]; }));
                    // Seed Books
                    console.log("Seeding ".concat(seedData.books.length, " books..."));
                    _c = 0, _d = seedData.books;
                    _f.label = 11;
                case 11:
                    if (!(_c < _d.length)) return [3 /*break*/, 14];
                    bookData = _d[_c];
                    categoryId = categoryMap.get(bookData.category);
                    return [4 /*yield*/, prisma.book.upsert({
                            where: { slug: bookData.slug },
                            update: {
                                title: bookData.title,
                                description: bookData.description || '',
                                price: bookData.price || 0,
                                mrp: bookData.mrp || 0,
                                stock: bookData.stock || 0,
                                isbn13: bookData.isbn,
                                edition: bookData.edition,
                                language: bookData.language || 'English',
                            },
                            create: {
                                title: bookData.title,
                                slug: bookData.slug,
                                description: bookData.description || '',
                                price: bookData.price || 0,
                                mrp: bookData.mrp || 0,
                                stock: bookData.stock || 0,
                                isbn13: bookData.isbn,
                                edition: bookData.edition,
                                language: bookData.language || 'English',
                                status: 'PUBLISHED',
                                isFeatured: false,
                                isTrending: !!bookData.trending,
                                isNewArrival: !!bookData.newRelease,
                                isBestseller: !!bookData.bestseller,
                                category: categoryId ? { connect: { id: categoryId } } : undefined,
                                authors: bookData.author ? {
                                    connectOrCreate: [{
                                            where: { slug: bookData.author.toLowerCase().replace(/\s+/g, '-') },
                                            create: { name: bookData.author, slug: bookData.author.toLowerCase().replace(/\s+/g, '-') }
                                        }]
                                } : undefined,
                                publisher: bookData.publisher ? {
                                    connectOrCreate: {
                                        where: { slug: bookData.publisher.toLowerCase().replace(/\s+/g, '-') },
                                        create: { name: bookData.publisher, slug: bookData.publisher.toLowerCase().replace(/\s+/g, '-') }
                                    }
                                } : undefined,
                            }
                        })];
                case 12:
                    _f.sent();
                    _f.label = 13;
                case 13:
                    _c++;
                    return [3 /*break*/, 11];
                case 14:
                    // Seed Homepage CMS sections
                    console.log('Seeding Homepage CMS sections...');
                    cmsSections = [
                        {
                            sectionKey: 'hero_banner',
                            title: 'Hero Banner',
                            sortOrder: 1,
                            configData: JSON.stringify({
                                headline: 'Your One-Stop Destination for Competitive Exam Books',
                                subtext: 'UPSC, SSC, Banking, Railways — All under one roof at the best prices',
                                ctaText: 'Shop Now',
                                ctaLink: '/listing',
                                bgImage: '',
                            }),
                        },
                        {
                            sectionKey: 'flash_sale',
                            title: 'Flash Sale',
                            sortOrder: 2,
                            configData: JSON.stringify({
                                headline: '🔥 Flash Sale — Up to 60% OFF',
                                subtext: 'Grab top-rated books before the offer expires!',
                                endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
                                badgeText: 'LIMITED TIME',
                            }),
                        },
                        {
                            sectionKey: 'featured_books',
                            title: 'Featured Books',
                            sortOrder: 3,
                            configData: JSON.stringify({
                                sectionTitle: 'Editor\'s Picks',
                                bookIds: [],
                                maxDisplay: 10,
                            }),
                        },
                        {
                            sectionKey: 'testimonials',
                            title: 'Testimonials',
                            sortOrder: 4,
                            configData: JSON.stringify({
                                sectionTitle: 'What Our Students Say',
                                items: [
                                    { name: 'Rahul Sharma', text: 'Got my UPSC books delivered in 2 days. Amazing quality!', rating: 5 },
                                    { name: 'Priya Patel', text: 'Best prices for SSC preparation books. Highly recommended!', rating: 5 },
                                    { name: 'Amit Kumar', text: 'The book quality is excellent and packaging was great.', rating: 4 },
                                ],
                            }),
                        },
                        {
                            sectionKey: 'sale_banner',
                            title: 'Sale Banner',
                            sortOrder: 5,
                            configData: JSON.stringify({
                                headline: 'Mega Book Sale — Flat 40% OFF on all categories',
                                ctaText: 'Browse Sale',
                                ctaLink: '/listing?sort=price-asc',
                                bgColor: '#065f46',
                            }),
                        },
                    ];
                    _e = 0, cmsSections_1 = cmsSections;
                    _f.label = 15;
                case 15:
                    if (!(_e < cmsSections_1.length)) return [3 /*break*/, 18];
                    section = cmsSections_1[_e];
                    return [4 /*yield*/, prisma.homepageCMS.upsert({
                            where: { sectionKey: section.sectionKey },
                            update: { title: section.title, sortOrder: section.sortOrder },
                            create: section,
                        })];
                case 16:
                    _f.sent();
                    _f.label = 17;
                case 17:
                    _e++;
                    return [3 /*break*/, 15];
                case 18:
                    console.log("".concat(cmsSections.length, " CMS sections seeded."));
                    console.log('Seed successful!');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .then(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); })
    .catch(function (e) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.error(e);
                return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                process.exit(1);
                return [2 /*return*/];
        }
    });
}); });
